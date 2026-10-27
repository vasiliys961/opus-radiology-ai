import type { CompletionCaller, VisionFrame } from "./vision-orchestra.ts";
import { assertVisionInput, parseStrictObject, readCompletionText } from "./vision-orchestra.ts";
import { assignImagingSpecialists } from "./imaging-specialist-consilium.ts";
import type { ImagingStudyProfile } from "./imaging-specialist-consilium.ts";
import type { BatchProviderResult } from "./vision-batch-executor.ts";
import type { VisionBatch } from "./vision-batch-ledger.ts";
import type { AiProvider } from "./ai-gateway.ts";
import type { EvidenceJson } from "./evidence-json.ts";
import { validateEvidenceJson } from "./evidence-json.ts";

/** Caller supplies approved, source-bound image copies; this module grants no upload permission. */
export function createGeminiBatchReviewer(
  images: readonly {index:number;frame:VisionFrame}[],
  profile:ImagingStudyProfile,
  options:{provider:AiProvider;visionModel:string;call:CompletionCaller},
): (batch:VisionBatch,batchIndex:number,signal?:AbortSignal)=>Promise<BatchProviderResult> {
  const specialists=assignImagingSpecialists(profile);
  if (!images.length || images.length>2000 || images.some((x,i)=>x.index!==i))
    throw new Error("Invalid image source order");
  return async (batch,_batchIndex,signal)=>{
    if (!batch.indices.length || batch.indices.length>4 || batch.indices.some(i=>!images[i]))
      throw new Error("Unsupported batch size or index");
    const frames=batch.indices.map(i=>images[i].frame);
    assertVisionInput({provider:options.provider,visionModel:options.visionModel,
      clinicalModel:options.visionModel,modality:profile.modality,frames});
    const ids=frames.map(f=>f.imageId);
    const reply=await options.call({provider:options.provider,role:"vision",model:options.visionModel,
      messages:[{role:"system",content:
        "Research radiology image review only. Do not infer unseen anatomy or normality. "+
        specialists.map(s=>s.specialty+": "+s.prompt).join(" ")+
        ' Return JSON {"reviewedImageIds":["id"],"observations":[{"id":"id","imageId":"id","anatomy":"region","sign":"observed","uncertainty":"limitation"}],"limitations":["text"]}.'},
        {role:"user",content:frames.flatMap(f=>[
          {type:"text",text:"Image ID "+f.imageId+" / "+f.viewLabel},
          {type:"image_url",image_url:{url:"data:"+f.mimeType+";base64,"+f.base64}},
        ])}],temperature:0},signal);
    const usage=(reply as {usage?:{prompt_tokens?:number;completion_tokens?:number}}).usage;
    if (!usage || !Number.isSafeInteger(usage.prompt_tokens) ||
        !Number.isSafeInteger(usage.completion_tokens) ||
        (usage.prompt_tokens??-1)<0 || (usage.completion_tokens??-1)<0)
      throw new Error("Provider usage receipt missing");
    const data=parseStrictObject(readCompletionText(reply)) as Record<string,unknown>;
    const reviewed=data.reviewedImageIds;
    const observations=data.observations;
    const limitations=data.limitations;
    if (!Array.isArray(reviewed)||reviewed.length!==ids.length ||
        !ids.every(id=>reviewed.includes(id)) ||
        !Array.isArray(observations)||observations.length>24||
        !Array.isArray(limitations)||limitations.length>12 ||
        !limitations.every(x=>typeof x==="string" && x.length<=500))
      throw new Error("Gemini batch source contract mismatch");
    const byId=new Map(frames.map(f=>[f.imageId,f]));
    const findings:EvidenceJson["findings"]=observations.map((v,i)=>{
      const o=v as Record<string,unknown>;
      const f=byId.get(String(o.imageId));
      if (!f||typeof o.id!=="string"||!o.id||o.id.length>80||
          typeof o.sign!=="string"||!o.sign||o.sign.length>500||
          typeof o.anatomy!=="string"||!o.anatomy||o.anatomy.length>180||
          typeof o.uncertainty!=="string"||!o.uncertainty||o.uncertainty.length>500)
        throw new Error("Unanchored Gemini observation");
      return {findingId:i+":"+o.id,sign:o.sign,anatomy:o.anatomy,
        status:"requires_recheck",source:{seriesUid:f.seriesUid,
          sopInstanceUid:f.sopInstanceUid,frameIndex:f.frameIndex,
          slicePositionMm:f.slicePositionMm},
        measurements:{diameterMm:null,volumeMl:null},
        model:{id:options.visionModel,provider:options.provider,version:null},
        limitations:[o.uncertainty,"Visual hypothesis, physician review required"]};
    });
    const evidence:EvidenceJson={schema:"opus-evidence/v1",modality:profile.modality,
      coverage:"partially_assessed",seriesReviewed:[...new Set(frames.map(f=>f.seriesUid))],
      findings,warnings:["Sampled image review only",...(limitations as string[])]};
    if (!validateEvidenceJson(evidence)) throw new Error("Invalid Gemini Evidence");
    return {evidence,reviewedIndices:[...batch.indices],
      usage:{inputTokens:usage.prompt_tokens!,outputTokens:usage.completion_tokens!}};
  };
}
