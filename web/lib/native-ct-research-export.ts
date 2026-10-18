/** Write one EXACT native source CT NIfTI by bounded blocks, never a whole
 * 3D ArrayBuffer. This writes ONLY to an explicitly user-selected local file;
 * no API, cloud, analytics, storage or model inference.
 */
import {sha256 as incrementalSha256} from "@noble/hashes/sha2.js";
import type {FullCtStream} from "./full-ct-stream.ts";

export type LocalFileWriter={
  write(data:ArrayBuffer):Promise<void>;
  close():Promise<void>;
  abort(reason?:unknown):Promise<void>;
};
export type NativeCtExportProof={
  schema:"opus-native-ct-research-export/v1";
  sourceNiftiSha256:string;
  dimensions:[number,number,number];
  suppliedFrameCount:number;
  writtenBytes:number;
  signedOrPatientAnonymizationVerified:false;
  fullAnatomicalCoverageVerified:false;
  originalDICOMFrameIdentityPresentInExport:false;
};
const validSHA=(v:string)=>/^[a-f0-9]{64}$/.test(v);
const MAX_FULL_NIFTI=352+512*512*300*4;
export function assertNativeResearchPacket(packet:FullCtStream){
 const r=packet.request,g=r.geometry,d=g.dimensions;
 if(r.schema!=="opus-analysis-request/v2"||r.modality!=="CT"||
    r.frameCount!==d[2]||r.frameCount<8||r.frameCount>300||
    d.length!==3||d[0]<8||d[0]>512||d[1]<8||d[1]>512||
    !validSHA(r.inputSha256)||!validSHA(r.sourceIdentitySha256)||
    r.input.datatype!=="float32"||r.input.format!=="NIfTI-1"||
    r.scope!=="selected-series-only"||
    !Number.isSafeInteger(packet.byteLength)||
    packet.byteLength!==352+d[0]*d[1]*d[2]*4||
    packet.byteLength>MAX_FULL_NIFTI)
   throw Error("Экспорт остановлен: нужен полный исходный HU-объём КТ с корректным SHA и NIfTI-1.");
}
/** Abort writer on mismatch/cancel. Verify second pass bytes AND SHA before close.
 * Chromium File System Access writes to a temporary file and commits on close.
 */
export async function saveExactNativeCt(
  packet:FullCtStream,writer:LocalFileWriter,signal:AbortSignal,
  onProgress:(writtenBytes:number,totalBytes:number)=>void=()=>{},
):Promise<NativeCtExportProof>{
 try{
  assertNativeResearchPacket(packet);
  const hash=incrementalSha256.create();let written=0;
  try{
   for await(const chunk of packet.chunks(signal)){
    if(signal.aborted)throw new DOMException("Экспорт отменён.","AbortError");
    if(!(chunk instanceof ArrayBuffer)||chunk.byteLength===0||chunk.byteLength>131072||
       written+chunk.byteLength>packet.byteLength)
      throw Error("Неверный блок исходной КТ.");
    hash.update(new Uint8Array(chunk));
    await writer.write(chunk);
    written+=chunk.byteLength;
    onProgress(written,packet.byteLength);
   }
   if(signal.aborted)throw new DOMException("Экспорт отменён.","AbortError");
   const digest=Array.from(hash.digest(),x=>x.toString(16).padStart(2,"0")).join("");
   if(written!==packet.byteLength||digest!==packet.request.inputSha256)
     throw Error("Повторное чтение DICOM изменило HU или SHA-256, файл не будет сохранён.");
   await writer.close();
   return{schema:"opus-native-ct-research-export/v1",
     sourceNiftiSha256:digest,
     dimensions:[...packet.request.geometry.dimensions],
     suppliedFrameCount:packet.request.frameCount,writtenBytes:written,
     signedOrPatientAnonymizationVerified:false,
     fullAnatomicalCoverageVerified:false,
     originalDICOMFrameIdentityPresentInExport:false};
  }finally{hash.destroy();}
 }catch(error){
   await writer.abort(error).catch(()=>{});
   throw error;
 }
}
/** User/operator attestation, never a machine claim of proven anonymization.
 * This file is intentionally separated from the images and exported on an
 * additional explicit click after reviewing the source study.
 */
export function publicNoduleAdmission(proof:NativeCtExportProof){
 if(proof.schema!=="opus-native-ct-research-export/v1"||
    !validSHA(proof.sourceNiftiSha256)||proof.suppliedFrameCount!==proof.dimensions[2])
   throw Error("Невозможно сформировать паспорт оригинальной КТ.");
 return{
  schema:"opus-public-chest-nodule-admission/v1",
  sourceNiftiSha256:proof.sourceNiftiSha256,
  modality:"CT",anatomy:"CHEST",intensity:"original-HU",
  publicOrRightsClearedData:true,containsPatientData:false,
  fullSelectedSeriesPresent:true,
  provenance:"Explicit research-operator attestation, not independently verified",
  fullChestAnatomicalCoverageVerified:false,
  cloudUploadAuthorized:false,
 };
}
