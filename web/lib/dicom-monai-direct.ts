/** Convert exact selected DICOM HU series to an OPFS-backed NIfTI File.
 * No save-file dialogue or 3D RAM buffer. File stays in this origin's
 * private browser storage, not on an external server. The physician can
 * immediately pass the original same bytes to the local MONAI worker.
 */
import type {DicomSeries} from "./dicom-series.ts";
import {createFullCtReader} from "./full-ct-decoder.ts";
import {prepareFullCtStream} from "./full-ct-stream.ts";
import {saveExactNativeCt,assertNativeResearchPacket} from "./native-ct-research-export.ts";

const NAME="opus-active-monai-chest-ct.nii";
type OpfsRoot=Pick<FileSystemDirectoryHandle,"getFileHandle"|"removeEntry">;

export async function prepareDicomMonaiFile(
 series:DicomSeries,files:File[],signal:AbortSignal,
 progress:(message:string)=>void=()=>{},
 storage?:OpfsRoot,
):Promise<File>{
 if(series.modality!=="CT"||series.members.length!==files.length||
    !series.members.every(m=>m.metadata.bodyRegion==="CHEST"))
   throw Error("Для MONAI нужна полная подтверждённая DICOM-КТ грудной клетки.");
 if(signal.aborted)throw new DOMException("Анализ отменён.","AbortError");
 if(!storage && (!navigator.storage || typeof navigator.storage.getDirectory!=="function"))
   throw Error("Браузер не поддерживает OPFS: откройте Opus в актуальном Chrome/Chromium.");
 const root=storage??await navigator.storage.getDirectory();
 const read=await createFullCtReader(files);
 progress("Подготавливаем настоящий HU-объём из DICOM-срезов…");
 const packet=await prepareFullCtStream(series,read,signal,
   n=>progress("Проверено срезов: "+n+"/"+series.members.length));
 assertNativeResearchPacket(packet);
 if(signal.aborted)throw new DOMException("Анализ отменён.","AbortError");
 // This fixed internal filename is never a user path or a DICOM identifier.
 // The prior study is replaced, rather than silently reused.
 const handle=await root.getFileHandle(NAME,{create:true});
 const writer=await handle.createWritable();
 try{
   const proof=await saveExactNativeCt(packet,writer,signal,(done,total)=>{
     progress("Подготовка HU-объёма: "+Math.floor(done/total*100)+"%");
   });
   if(signal.aborted)throw new DOMException("Анализ отменён.","AbortError");
   const file=await handle.getFile();
   if(file.size!==proof.writtenBytes)
     throw Error("Временная КТ не совпадает с проверенным исходным объёмом.");
   progress("Полная КТ подготовлена; запускайте MONAI на этом исследовании.");
   return file;
 }catch(error){
   await writer.abort(error).catch(()=>{});
   await root.removeEntry(NAME).catch(()=>{});
   throw error;
 }
}
