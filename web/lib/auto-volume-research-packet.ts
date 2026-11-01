/** Research-only auto-redacted PNG review.
 * Never claims a clinician inspected each individual raster. An explicit
 * study-wide opt-in and localhost-only server flag are required at the route.
 * Source DICOM UIDs must NEVER be accepted in the outgoing packet.
 */
import {createPrivacyFrame,pngFromBase64} from "./vision-privacy.ts";
import type {NormalizedCloudPilot} from "./sanitized-cloud-review.ts";
export type AutoVolumePacket={
 schema:"opus-public-volume-auto-ocr/v1";
 modality:"CT"|"MR";
 frames:Array<{frameId:string;pngBase64:string;sha256:string;
   ocrSha256:string;ocrClear:true}>;
};
export function normalizeAutoPublicVolumePacket(input:unknown):NormalizedCloudPilot{
 if(!input||typeof input!=="object"||Array.isArray(input))
   throw Error("Invalid auto volume study packet");
 const v=input as Record<string,unknown>;
 if(Object.keys(v).sort().join("|")!=="frames|modality|schema"||
    v.schema!=="opus-public-volume-auto-ocr/v1"||
    (v.modality!=="CT"&&v.modality!=="MR")||
    !Array.isArray(v.frames)||v.frames.length<1||v.frames.length>4)
   throw Error("Only finite CT/MR auto research batches are supported");
 let total=0;
 const frames=v.frames.map((raw,i)=>{
   if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Missing raster");
   const f=raw as Record<string,unknown>;
   if(Object.keys(f).sort().join("|")!==
      "frameId|ocrClear|ocrSha256|pngBase64|sha256"||
      f.frameId!=="frame-"+(i+1)||f.ocrClear!==true||
      typeof f.pngBase64!=="string"||typeof f.sha256!=="string"||
      typeof f.ocrSha256!=="string"||f.sha256!==f.ocrSha256)
     throw Error("Original OCR scan does not match exact outgoing image");
   total+=f.pngBase64.length;
   const clean=createPrivacyFrame(pngFromBase64(f.pngBase64),
      f.frameId as string,v.modality as "CT"|"MR");
   if(clean.sha256!==f.sha256)throw Error("Outgoing PNG bytes modified after OCR");
   return {imageId:clean.frameId,base64:clean.pngBase64,sha256:clean.sha256};
 });
 if(total>2_000_000||new Set(frames.map(f=>f.imageId)).size!==frames.length)
   throw Error("Raster payload budget exceeded");
 return {modality:v.modality,frames:frames.map(f=>({imageId:f.imageId,base64:f.base64})),
   localFrameHashes:frames.map(f=>({imageId:f.imageId,reviewedPixelSha256:f.sha256}))};
}
