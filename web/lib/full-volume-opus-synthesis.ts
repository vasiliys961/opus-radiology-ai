/** Final single text-only Claude Opus synthesis after complete, verified Gemini volume.
 * Never receives images, native DICOM identifiers, filenames or patient metadata.
 */
import type {SafeVolumeOpusInput} from "./full-volume-receipts.ts";
import {SENIOR_RADIOLOGIST_PROMPT,hasRadiologistReportSections,
  canonicalizeRadiologistHeadings} from "./senior-radiologist-report.ts";
import {parseStrictObject,readCompletionText} from "./vision-orchestra.ts";
import type {AiGatewayRequest} from "./ai-gateway.ts";
import {validateSanitizedDetectorBundle} from "./detector-consilium-evidence.ts";

export const FULL_VOLUME_OPUS="anthropic/claude-opus-5.5";
export type FullVolumeOpusResult={
  schema:"opus-full-volume-radiologist/v1";
  modality:"CT"|"MR";overviewReviewed:number;plannedFrames:number;
  finalReport:string;limitations:string[];
  clinicalValidation:false;physicianSignatureRequired:true;
  receipt:{inputTokens:number;outputTokens:number};
};
export function validateSafeFullVolumeOpusInput(value:unknown):value is SafeVolumeOpusInput{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join("|")!==[
    "schema","modality","plannedFrames","overviewReviewed","targetedReviewed",
    "completedBatches","totalBatches","observations","limitations",
    "detectorState","detectorEvidence","acknowledgePaidOpusSynthesis",
  ].sort().join("|")||
    v.schema!=="opus-volume-synthesis-request/v1"||
    !["CT","MR"].includes(String(v.modality))||
    !Number.isSafeInteger(v.plannedFrames)||(v.plannedFrames as number)<1||
    (v.plannedFrames as number)>2000||v.overviewReviewed!==v.plannedFrames||
    !Number.isSafeInteger(v.targetedReviewed)||(v.targetedReviewed as number)<0||
    (v.targetedReviewed as number)>2000||
    !Number.isSafeInteger(v.completedBatches)||(v.completedBatches as number)<1||
    v.completedBatches!==v.totalBatches||
    v.acknowledgePaidOpusSynthesis!==true||
    !["completed","unavailable","timeout"].includes(String(v.detectorState))||
    (v.detectorEvidence!==null&&(!validateSanitizedDetectorBundle(v.detectorEvidence)||
      v.detectorEvidence.modality!==v.modality))||
    !Array.isArray(v.observations)||v.observations.length>180||
    !Array.isArray(v.limitations)||v.limitations.length>30||
    !v.limitations.every(x=>typeof x==="string"&&x.length<=500))return false;
  for(const o of v.observations){
    if(!o||typeof o!=="object"||Array.isArray(o))return false;
    const f=o as Record<string,unknown>;
    if(Object.keys(f).sort().join("|")!==["sliceNumber","pass","anatomy","sign","uncertainty"].sort().join("|")||
       !Number.isSafeInteger(f.sliceNumber)||(f.sliceNumber as number)<1||
       (f.sliceNumber as number)>(v.plannedFrames as number)||
       !["overview","targeted"].includes(String(f.pass))||
       !["anatomy","sign","uncertainty"].every(k=>
         typeof f[k]==="string"&&(f[k] as string).trim().length>0&&
         (f[k] as string).length<=(k==="anatomy"?180:500)))return false;
  }
  return JSON.stringify(v).length<=110000;
}
export async function synthesizeSafeFullVolumeOpus(
  raw:unknown,
  call:(request:AiGatewayRequest,signal?:AbortSignal)=>Promise<{
    choices?:unknown;usage?:{prompt_tokens?:number;completion_tokens?:number}|null;
  }>,
  signal?:AbortSignal,
):Promise<FullVolumeOpusResult>{
  if(!validateSafeFullVolumeOpusInput(raw))throw Error("Invalid complete volume input");
  const study=raw;
  const response=await call({
    provider:"openrouter",role:"reasoning",model:FULL_VOLUME_OPUS,maxTokens:3500,
    responseFormat:{type:"json_schema",json_schema:{
      name:"complete_volume_radiologist",
      strict:true,
      schema:{type:"object",additionalProperties:false,
        properties:{
          summary:{type:"string",description:"Full Russian radiologist protocol with standard five sections"},
          limitations:{type:"array",maxItems:12,items:{type:"string"}},
        },required:["summary","limitations"]},
    }},requireParameters:true,
    messages:[
      {role:"system",content:
        SENIOR_RADIOLOGIST_PROMPT+"\n"+
        "ADDITIONAL INSTRUCTION: You receive text-only independent Gemini observations "+
        "from a frame-by-frame overview of the complete selected CT/MR DICOM series. "+
        "You did NOT directly see all original pixels, only Gemini observations. "+
        "Detector candidate data are separate and can be incomplete or discordant. "+
        "Compare positive findings, note which detectors did not run, and never "+
        "infer a negative diagnosis from missing or empty detector output. "+
        "Do not claim a direct independent image review, completed MRI sequences, "+
        "other anatomical series, multi-window CT, contrast phases or absent findings. "+
        "Avoid the old sampled-only closing sentence if all planned frames were reviewed. "+
        "Use the five exact Russian section headings. Do not output names or private identifiers. "+
        'Return ONLY JSON {"summary":"radiology protocol","limitations":["limitations"]}.'},
      {role:"user",content:JSON.stringify({
        modality:study.modality,
        plannedOriginalDICOMFrames:study.plannedFrames,
        geminiOverviewReviewedFrames:study.overviewReviewed,
        geminiTargetedReviewedFrames:study.targetedReviewed,
        completedBatches:study.completedBatches,
        totalBatches:study.totalBatches,
        sourceBoundGeminiObservations:study.observations,
        limitations:study.limitations,
        sourceImagesGivenToOpus:false,
        originalDetectorEvidenceGivenToOpus:study.detectorEvidence!==null,
        detectorState:study.detectorState,
        verifiedDetectorFacts:study.detectorEvidence?.facts??[],
        verifiedDetectorRegion:study.detectorEvidence?.region??null,
      })},
    ],
  },signal);
  const parsed=parseStrictObject(readCompletionText(response));
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
    throw Error("Invalid Opus synthesis JSON");
  const data=parsed as Record<string,unknown>;
  if(Object.keys(data).sort().join("|")!==["summary","limitations"].sort().join("|")||
     typeof data.summary!=="string"||!Array.isArray(data.limitations)||
     data.limitations.length>12||
     !data.limitations.every(x=>typeof x==="string"&&x.length<=500))
    throw Error("Opus omitted required report fields");
  const report=canonicalizeRadiologistHeadings(data.summary);
  if(!hasRadiologistReportSections(report))
    throw Error("Opus did not produce complete standard radiologist sections");
  const usage=response.usage;
  if(!usage||!Number.isSafeInteger(usage.prompt_tokens)||!Number.isSafeInteger(usage.completion_tokens)||
     usage.prompt_tokens!<0||usage.completion_tokens!<0)
    throw Error("Opus token receipt missing");
  return {
    schema:"opus-full-volume-radiologist/v1",
    modality:study.modality,overviewReviewed:study.overviewReviewed,
    plannedFrames:study.plannedFrames,finalReport:report,limitations:data.limitations as string[],
    clinicalValidation:false,physicianSignatureRequired:true,
    receipt:{inputTokens:usage.prompt_tokens!,outputTokens:usage.completion_tokens!},
  };
}
