/** One selected ORIGINAL DICOM MR series -> exact source scalar NIfTI in OPFS.
 * No guessed MRI weighting, no full 3-D RAM buffer, no patient cloud.
 */
import {sha256 as incrementalSha256} from "@noble/hashes/sha2.js";
import type {DicomSeries} from "./dicom-series.ts";
import {createFullCtReader} from "./full-ct-decoder.ts";
import {prepareFullMrStream} from "./full-ct-stream.ts";

export type MrRole="dwi"|"adc"|"flair"|"t1ce"|"t1"|"t2";
type OpfsRoot=Pick<FileSystemDirectoryHandle,"getFileHandle"|"removeEntry">;
export async function prepareNativeBrainMr(
 series:DicomSeries,files:readonly File[],role:MrRole,
 signal:AbortSignal,progress:(s:string)=>void=()=>{},
 rootOverride?:OpfsRoot,
):Promise<File>{
 if(series.modality!=="MR"||!series.members.length||
    !series.members.every(m=>m.metadata.bodyRegion==="HEAD")||
    files.length!==series.members.length||
    !["dwi","adc","flair","t1ce","t1","t2"].includes(role))
  throw Error("Исходная МРТ головы неполна, последовательность не подтверждена.");
 if(!rootOverride&&(!navigator.storage||typeof navigator.storage.getDirectory!=="function"))
  throw Error("Для исходной 3D МРТ требуется OPFS в Chromium.");
 const root=rootOverride??await navigator.storage.getDirectory();
 const reader=await createFullCtReader(files);
 const packet=await prepareFullMrStream(series,reader,signal,
  n=>progress("Подготовлено "+role+" срезов "+n+" из "+files.length));
 const req=packet.request,d=req.geometry.dimensions;
 if(req.modality!=="MR"||req.frameCount!==d[2]||req.frameCount<8||
    packet.byteLength!==352+d.reduce((a,b)=>a*b,1)*4||
    packet.byteLength>352+512*512*300*4||
    !/^[a-f0-9]{64}$/.test(req.inputSha256))
   throw Error("3D исходная МРТ не прошла проверку геометрии и объёма.");
 const name="opus-original-brain-"+role+".nii";
 const handle=await root.getFileHandle(name,{create:true});
 const writer=await handle.createWritable();
 let committed=false;
 try{
  const hash=incrementalSha256.create();let done=0;
  try{
   for await(const chunk of packet.chunks(signal)){
    if(signal.aborted)throw new DOMException("МРТ отменена.","AbortError");
    if(!(chunk instanceof ArrayBuffer)||chunk.byteLength<1||
       chunk.byteLength>131072||done+chunk.byteLength>packet.byteLength)
      throw Error("Несовместимый исходный блок МРТ.");
    hash.update(new Uint8Array(chunk));
    await writer.write(chunk);done+=chunk.byteLength;
   }
   const sha=Array.from(hash.digest(),n=>n.toString(16).padStart(2,"0")).join("");
   if(done!==packet.byteLength||sha!==req.inputSha256)
     throw Error("Исходная последовательность изменилась при повторном чтении.");
  }finally{hash.destroy();}
  await writer.close();committed=true;
  const file=await handle.getFile();
  if(file.size!==packet.byteLength)throw Error("Объём исходной МРТ изменился.");
  return file;
 }catch(e){
  if(!committed)await writer.abort(e).catch(()=>{});
  await root.removeEntry(name).catch(()=>{});
  throw e;
 }
}
