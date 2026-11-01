/** Single approved, metadata-free, 1-4 PNG Gemini batch.
 * The native SOP UID -> outgoing frame slot mapping MUST remain on the
 * clinician's browser; this module must never receive source DICOM headers.
 */
import {normalizeReviewedCloudPilot,sourceFrameReviewFormat,PILOT_GEMINI} from "./sanitized-cloud-review.ts";
import {parseRoleResponse,parseStrictObject,readCompletionText,type RoleResponse} from "./vision-orchestra.ts";
import type {AiGatewayRequest} from "./ai-gateway.ts";

export type VolumeGeminiBatchResult={
  schema:"opus-gemini-volume-batch/v1";
  model:typeof PILOT_GEMINI;
  modality:"CT"|"MR";
  imagesReviewed:number;
  observations:RoleResponse["observations"];
  limitations:string[];
  reviewedImageIds:string[];
  receipt:{inputTokens:number;outputTokens:number};
  clinicalValidation:false;
  sourceBindingsLocalOnly:true;
};
export type VolumeGeminiBatchCaller=
  (request:AiGatewayRequest,signal?:AbortSignal)=>Promise<{
    choices?:unknown;
    usage?:{prompt_tokens?:number;completion_tokens?:number}|null;
  }>;
export async function reviewApprovedVolumeGeminiBatch(
  packet:unknown,call:VolumeGeminiBatchCaller,signal?:AbortSignal,
):Promise<VolumeGeminiBatchResult>{
  const checked=normalizeReviewedCloudPilot(packet);
  if(checked.modality!=="CT"&&checked.modality!=="MR")
    throw Error("Only CT/MR volume frames are allowed");
  const ids=checked.frames.map(x=>x.imageId);
  const messages:AiGatewayRequest["messages"]=[
    {role:"system",content:
      "Independent radiology visual observations on approved sampled CT/MR PNG pixels only. "+
      "Do NOT infer normality, pathology absence, volumes, anatomy outside these frames, "+
      "clinical history, names, identifiers or DICOM metadata. "+
      "For every supplied frame include its exact image ID in reviewedImageIds. "+
      'Return ONLY schema-compliant JSON with role "observations", source-bound signs and uncertainties.'},
    {role:"user",content:checked.frames.flatMap((f,i)=>[
      {type:"text",text:"Visible CT/MR slice "+(i+1)+" image ID "+f.imageId+
        ". This is one batch of a larger volume; do not assess unseen slices."},
      {type:"image_url",image_url:{url:"data:image/png;base64,"+f.base64}},
    ])},
  ];
  const response=await call({
    provider:"openrouter",role:"vision",model:PILOT_GEMINI,
    maxTokens:1800,temperature:0,
    responseFormat:sourceFrameReviewFormat(ids),requireParameters:true,messages,
  },signal);
  const observation=parseRoleResponse(
    parseStrictObject(readCompletionText(response)),"observations",ids);
  if(observation.reviewedImageIds.length!==ids.length||
     new Set(observation.reviewedImageIds).size!==ids.length||
     ids.some(id=>!observation.reviewedImageIds.includes(id)))
    throw Error("Incomplete Gemini batch acknowledgement");
  const usage=response.usage;
  if(!usage||!Number.isSafeInteger(usage.prompt_tokens)||
     !Number.isSafeInteger(usage.completion_tokens)||
     usage.prompt_tokens!<0||usage.completion_tokens!<0)
    throw Error("Gemini did not return a valid billable usage receipt");
  return {
    schema:"opus-gemini-volume-batch/v1",
    model:PILOT_GEMINI,modality:checked.modality,imagesReviewed:ids.length,
    observations:observation.observations,limitations:observation.limitations,
    reviewedImageIds:ids,
    receipt:{inputTokens:usage.prompt_tokens!,outputTokens:usage.completion_tokens!},
    clinicalValidation:false,sourceBindingsLocalOnly:true,
  };
}
