"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {fullCtGeometry,prepareFullCtStream} from "../lib/full-ct-stream";
import {createFullCtReader} from "../lib/full-ct-decoder";
import {saveExactNativeCt,publicNoduleAdmission,
  type LocalFileWriter,type NativeCtExportProof} from "../lib/native-ct-research-export";
import {acquireBrowserCompute} from "../lib/browser-compute-slot";

type LocalFileHandle={createWritable():Promise<LocalFileWriter>};
type LocalSavePicker={
  showSaveFilePicker(options:{
    suggestedName:string;types:{description:string;accept:Record<string,string[]>}[];
  }):Promise<LocalFileHandle>;
};
/** Converts one full original public CHEST DICOM series directly to a native
 * exact NIfTI on the user's own disk. NO server, provider or model egress.
 * Requires a browser supporting streaming file-write (Chromium).
 */
export default function NativeCtResearchExport({
  series,files,
}:{series:DicomSeries;files:File[]}){
 const [supported,setSupported]=useState(false);
 const [authorized,setAuthorized]=useState(false);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 const [error,setError]=useState("");
 const [proof,setProof]=useState<NativeCtExportProof|null>(null);
 const active=useRef<AbortController|null>(null),generation=useRef(0);
 useEffect(()=>{setSupported(typeof (window as Window&Partial<LocalSavePicker>).showSaveFilePicker==="function");},[]);
 useEffect(()=>{
   generation.current++;active.current?.abort();
   setProof(null);setAuthorized(false);setError("");setStatus("");
   return ()=>{generation.current++;active.current?.abort();};
 },[series]);
 const unsupported=useMemo(()=>{
   if(series.modality!=="CT"||!series.members.every(m=>m.metadata.bodyRegion==="CHEST"))
     return "Экспорт детектора узлов разрешён только для серии КТ грудной клетки с подтверждённой анатомией.";
   if(files.length!==series.members.length)
     return "Часть исходных DICOM-файлов недоступна.";
   try{fullCtGeometry(series);return "";}
   catch(e){return e instanceof Error?e.message:"Неподдерживаемая исходная геометрия КТ.";}
 },[series,files]);
 if(series.modality!=="CT")return null;
 async function run(){
   if(busy||!supported||!authorized||!!unsupported||proof)return;
   const revision=++generation.current,controller=new AbortController();
   active.current=controller;
   setBusy(true);setError("");setStatus("Выберите локальный файл для исходной NIfTI КТ…");
   let release:(()=>void)|undefined;
   try{
     // Call the native file picker directly from this user click before any
     // await that could lose browser activation.
     const picker=(window as Window&Partial<LocalSavePicker>).showSaveFilePicker;
     if(!picker)throw Error("Браузер не поддерживает потоковую запись. Откройте локальный Opus в Chromium.");
     const handle=await picker({
       suggestedName:"opus-original-public-chest.nii",
       types:[{description:"Оригинальная КТ NIfTI-1 (HU)",accept:{"application/octet-stream":[".nii"]}}],
     });
     if(revision!==generation.current||controller.signal.aborted)return;
     release=acquireBrowserCompute("native-ct-export");
     setStatus("Проверка исходных DICOM и SHA-256 без сборки всего объёма…");
     const read=await createFullCtReader(files);
     const packet=await prepareFullCtStream(series,read,controller.signal,n=>{
       if(revision===generation.current)setStatus("Проверка скалярной КТ: "+n+"/"+series.members.length+" срезов");
     });
     if(revision!==generation.current||controller.signal.aborted)return;
     const writer=await handle.createWritable();
     const result=await saveExactNativeCt(packet,writer,controller.signal,(written,total)=>{
       if(revision===generation.current)setStatus("Запись исходной КТ: "+Math.floor(written/total*100)+"%");
     });
     if(revision!==generation.current)return;
     setProof(result);setStatus("Сохранена точная полная переданная серия CT NIfTI · SHA-256 проверен дважды. Доступен отдельный исследовательский паспорт для MONAI.");
   }catch(e){
     if(revision===generation.current){
       if(e instanceof DOMException&&e.name==="AbortError")
         setStatus("Выбор файла или экспорт отменён; диагностического результата нет.");
       else setError(e instanceof Error?e.message:"Исходная КТ не экспортирована.");
     }
   }finally{
     release?.();
     if(active.current===controller)active.current=null;
     if(revision===generation.current)setBusy(false);
   }
 }
 function manifest(){
   if(!proof)return;
   const data=publicNoduleAdmission(proof);
   const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
   const a=document.createElement("a");a.href=url;a.download="opus-public-chest-monai-admission.json";
   a.click();setTimeout(()=>URL.revokeObjectURL(url),400);
 }
 return <details className="cs-nodule-export">
   <summary>Экспорт исходной КТ для настоящих детекторов MONAI / task315</summary>
   <p>Оригинальный DICOM → точный NIfTI (float32 HU). Без облака и без накопления всей КТ в RAM.
     Источник остаётся на вашем компьютере; инференс выполняется отдельно на подходящем Linux CPU.</p>
   {!supported&&<p role="status">Для больших файлов требуется Chromium/Chrome с локальной потоковой записью на диск. Safari в этом режиме не поддерживается; лимит памяти не увеличиваем.</p>}
   {unsupported&&<p role="status">Экспорт недоступен: {unsupported}</p>}
   <label><input type="checkbox" checked={authorized} disabled={busy||!!proof}
     onChange={e=>setAuthorized(e.target.checked)}/>
     Подтверждаю: только публичная, обезличенная КТ грудной клетки с разрешённым использованием. Это весь предоставленный набор срезов, но полнота анатомии не доказана.
   </label>
   <button type="button" disabled={!supported||!!unsupported||!authorized||busy||!!proof} onClick={()=>void run()}>
     Сохранить оригинальную КТ NIfTI на этом компьютере
   </button>
   {busy&&<button type="button" onClick={()=>active.current?.abort()}>Отменить экспорт</button>}
   {error&&<p role="alert">{error}</p>}
   {status&&<p role="status">{status}</p>}
   {proof&&<>
     <p>Срезов {proof.suppliedFrameCount}; байт {proof.writtenBytes.toLocaleString("ru-RU")};
     SHA-256: <code>{proof.sourceNiftiSha256}</code>.</p>
     <button type="button" onClick={manifest}>Скачать паспорт для запуска MONAI</button>
     <p>Следующий шаг — локальный исследовательский Linux-исполнитель: оригинальный .nii вместе с паспортом;
     результат импортируется через вкладку «MONAI · узлы КТ». Перенос пациента в облако не разрешён.</p>
     <a href="/viewer" aria-label="Исследовательская вкладка MONAI">Вкладка MONAI в этом просмотрщике</a>
   </>}
 </details>;
}
