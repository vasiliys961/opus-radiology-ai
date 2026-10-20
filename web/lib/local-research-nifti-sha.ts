/** Byte-exact source NIfTI hash, local-only in bounded browser memory.
 * Does not decode voxels, attest image permission, or send any pixels.
 */
import {sha256} from "@noble/hashes/sha2.js";
const CHUNK_SIZE=2*1024*1024;
const MAX_NIFTI=900*1024*1024;
export async function hashLocalNifti(
  blob:Blob,signal?:AbortSignal,onProgress:(read:number,total:number)=>void=()=>{}
):Promise<string>{
 if(!Number.isSafeInteger(blob.size)||blob.size<256||blob.size>MAX_NIFTI)
  throw Error("Файл NIfTI недопустимого размера (максимум 900 МиБ).");
 const h=sha256.create();let count=0;
 try{
  for(let pos=0;pos<blob.size;pos+=CHUNK_SIZE){
   if(signal?.aborted)throw new DOMException("Проверка SHA-256 отменена.","AbortError");
   const chunk=await blob.slice(pos,Math.min(pos+CHUNK_SIZE,blob.size)).arrayBuffer();
   const expect=Math.min(CHUNK_SIZE,blob.size-pos);
   if(chunk.byteLength!==expect)throw Error("Чтение оригинального NIfTI было неполным.");
   h.update(new Uint8Array(chunk));
   count+=chunk.byteLength;
   if(count===blob.size||count%(16*1024*1024)===0)onProgress(count,blob.size);
  }
  if(signal?.aborted)throw new DOMException("Проверка SHA-256 отменена.","AbortError");
  if(count!==blob.size)throw Error("Изображение прочитано не полностью.");
  return Array.from(h.digest(),x=>x.toString(16).padStart(2,"0")).join("");
 }finally{h.destroy();}
}
