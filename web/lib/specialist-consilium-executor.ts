/** Evidence-first specialist execution over an explicitly approved research image set.
 * Caller controls authorization and transport; this module never enables patient cloud upload.
 */
import type { AiGatewayRequest } from "./ai-gateway.ts";
import { assignImagingSpecialists, CONSILIUM_OPUS_PROMPT } from "./imaging-specialist-consilium.ts";
import type { ImagingStudyProfile } from "./imaging-specialist-consilium.ts";
import type { EvidenceJson, AnatomicalFinding } from "./evidence-json.ts";
import { validateEvidenceJson } from "./evidence-json.ts";
import { assertVisionInput, parseStrictObject, readCompletionText, parseClinicalDraft } from "./vision-orchestra.ts";
import type { VisionInput, CompletionCaller, ClinicalDraft } from "./vision-orchestra.ts";

export type SpecialistConsiliumResult = {
  schema:"opus-specialist-consilium/v1";
  specialists:string[];
  visionEvidence:EvidenceJson;
  detectorEvidence:EvidenceJson[];
  draft:ClinicalDraft;
  status:"unverified_research_draft";
};
type SpecialistObservation={id:string;imageId:string;anatomy:string;sign:string;uncertainty:string};
function parseObservations(value:unknown, imageIds:readonly string[]):{
  reviewedImageIds:string[];observations:SpecialistObservation[];limitations:string[]
} {
  if (!value || typeof value!=="object") throw new Error("Invalid specialist result");
  const v=value as Record<string,unknown>;
  const strings=(x:unknown,max:number,chars:number):x is string[]=>Array.isArray(x)&&
    x.length<=max&&x.every(s=>typeof s==="string"&&s.length>0&&s.length<=chars);
  if (!strings(v.reviewedImageIds,4,100)||!Array.isArray(v.reviewedImageIds)||v.reviewedImageIds.length!==imageIds.length||
      new Set(v.reviewedImageIds).size!==imageIds.length||
      !imageIds.every(id=>v.reviewedImageIds.includes(id))||
      !strings(v.limitations,12,500)||!Array.isArray(v.observations)||v.observations.length>18)
    throw new Error("Incomplete specialist source coverage");
  const seen=new Set<string>();
  const observations:SpecialistObservation[]=v.observations.map(item=>{
    if (!item||typeof item!=="object") throw new Error("Invalid finding");
    const o=item as Record<string,unknown>;
    if (typeof o.id!=="string"||!o.id||o.id.length>70||seen.has(o.id)||
        typeof o.imageId!=="string"||!imageIds.includes(o.imageId)||
        typeof o.anatomy!=="string"||!o.anatomy||o.anatomy.length>180||
        typeof o.sign!=="string"||!o.sign||o.sign.length>500||
        typeof o.uncertainty!=="string"||!o.uncertainty||o.uncertainty.length>500)
      throw new Error("Unanchored specialist finding");
    seen.add(o.id);
    return o as unknown as SpecialistObservation;
  });
  return {reviewedImageIds:v.reviewedImageIds,observations,limitations:v.limitations};
}
export async function runSpecialistConsilium(
  input:VisionInput, profile:ImagingStudyProfile, detectorEvidence:readonly EvidenceJson[],
  call:CompletionCaller, signal?:AbortSignal,
):Promise<SpecialistConsiliumResult> {
  assertVisionInput(input);
  if (profile.modality!==input.modality) throw new Error("Study modality mismatch");
  if (!Array.isArray(detectorEvidence)||detectorEvidence.length>18||
      detectorEvidence.some(e=>!validateEvidenceJson(e)||e.modality!==input.modality))
    throw new Error("Invalid detector evidence");
  const ids=input.frames.map(f=>f.imageId);
  const frames=new Map(input.frames.map(f=>[f.imageId,f]));
  const specialists=assignImagingSpecialists(profile);
  const findings:AnatomicalFinding[]=[];
  const warnings:string[]=["Specialist vision assessment is limited to supplied frames; no complete-volume exclusion."];
  // Visual reviewers see images and study protocol, NOT detector predictions.
  for (const assignment of specialists) {
    const messages:AiGatewayRequest["messages"]=[
      {role:"system",content:assignment.prompt+
        ' Return ONLY JSON {"reviewedImageIds":["image-id"],"observations":[{"id":"id","imageId":"image-id","anatomy":"region","sign":"observed sign","uncertainty":"limitations"}],"limitations":["text"]}.'},
      {role:"user",content:[
        {type:"text",text:"Inspect only provided "+input.modality+" images and return exact IDs."},
        ...input.frames.flatMap(f=>[
          {type:"text",text:"Image "+f.imageId+" / "+f.viewLabel},
          {type:"image_url",image_url:{url:"data:"+f.mimeType+";base64,"+f.base64}},
        ]),
      ]},
    ];
    const response=await call({provider:input.provider,role:"vision",model:input.visionModel,messages,temperature:0},signal);
    const parsed=parseObservations(parseStrictObject(readCompletionText(response)),ids);
    warnings.push(...parsed.limitations.map(t=>assignment.specialty+": "+t).slice(0,12));
    for (const observation of parsed.observations) {
      const source=frames.get(observation.imageId)!;
      findings.push({
        findingId:assignment.specialty+":"+observation.id,sign:observation.sign,anatomy:observation.anatomy,
        status:"requires_recheck",
        source:{seriesUid:source.seriesUid,sopInstanceUid:source.sopInstanceUid,
          frameIndex:source.frameIndex,slicePositionMm:source.slicePositionMm},
        measurements:{diameterMm:null,volumeMl:null},
        model:{id:input.visionModel,provider:input.provider,version:null},
        limitations:[observation.uncertainty,"Specialist LLM observation; requires physician verification"],
      });
    }
  }
  const visionEvidence:EvidenceJson={
    schema:"opus-evidence/v1",modality:input.modality,coverage:"partially_assessed",
    seriesReviewed:[...new Set(input.frames.map(f=>f.seriesUid))],
    findings,warnings:warnings.slice(0,100),
  };
  if (!validateEvidenceJson(visionEvidence)) throw new Error("Invalid fused specialist evidence");
  // Opus receives independently attributed sources; it must not silently combine or erase disagreements.
  const response=await call({
    provider:input.provider,role:"reasoning",model:input.clinicalModel,temperature:0,
    messages:[
      {role:"system",content:CONSILIUM_OPUS_PROMPT+
        ' Return ONLY JSON {"summary":"unsigned qualified draft","limitations":["text"]}.'},
      {role:"user",content:JSON.stringify({modality:input.modality,profile,
        visionEvidence,detectorEvidence})},
    ],
  },signal);
  const draft=parseClinicalDraft(parseStrictObject(readCompletionText(response)));
  return {schema:"opus-specialist-consilium/v1",specialists:specialists.map(x=>x.specialty),
    visionEvidence,detectorEvidence:[...detectorEvidence],draft,status:"unverified_research_draft"};
}
