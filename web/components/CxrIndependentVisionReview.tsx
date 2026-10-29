"use client";

import {useEffect,useMemo,useState} from "react";
import {decodeDicomPreview} from "../lib/dicom-lite";
import {sha256} from "@noble/hashes/sha2.js";
import type {DicomSeries} from "../lib/dicom-series";
import {parseOriginalXrvReport,type OriginalXrvCxrResult} from "../lib/xrv-original-cxr";
import VisionPrivacyPreparation from "./VisionPrivacyPreparation";

function checksum(bytes:Uint8Array){
 return Array.from(sha256(bytes),x=>x.toString(16).padStart(2,"0")).join("");
}
async function downsampleReviewedCxr(url:string,signal:AbortSignal):Promise<string>{
 const image=new Image();
 image.decoding="async";
 image.src=url;
 await image.decode();
 if(signal.aborted)throw new DOMException("Исследование изменилось.","AbortError");
 if(image.width<128||image.height<128||image.width*image.height>4096*4096)
   throw Error("Размер исходной рентгенограммы не подходит для визуальной оценки.");
 const ratio=Math.min(1,1000/image.width,1000/image.height);
 const canvas=document.createElement("canvas");
 canvas.width=Math.max(1,Math.floor(image.width*ratio));
 canvas.height=Math.max(1,Math.floor(image.height*ratio));
 const context=canvas.getContext("2d");
 if(!context)throw Error("Нельзя подготовить обезличенную PNG-копию.");
 context.drawImage(image,0,0,canvas.width,canvas.height);
 return canvas.toDataURL("image/png");
}

/** Run only AFTER genuinely completed original TorchXRayVision. No image cloud
 * upload or paid provider requests without explicit clinician pixel review.
 */
export default function CxrIndependentVisionReview({
 series,files,report,onNavigate,
}:{
 series:DicomSeries;
 files:ReadonlyMap<string,File>;
 report:OriginalXrvCxrResult;
 onNavigate:(index:number)=>void;
}){
 const [preview,setPreview]=useState<string|null>(null);
 const [status,setStatus]=useState("Готовим ограниченную копию рентгенограммы...");
 const [error,setError]=useState("");
 const localIds=useMemo(()=>[series.members[0]?.id??""],[series]);
 const previews=useMemo(()=>preview?[preview]:[],[preview]);
 useEffect(()=>{
  const controller=new AbortController();
  setPreview(null);setError("");setStatus("Сверяем DICOM и снимок оригинального детектора...");
  void (async()=>{
    parseOriginalXrvReport(report);
    if((series.modality!=="CR"&&series.modality!=="DX")||series.members.length!==1)
      throw Error("Это не одиночная CR/DX рентгенограмма.");
    const file=files.get(series.members[0].id);
    if(!file)throw Error("Оригинальный DICOM больше недоступен.");
    const decoded=await decodeDicomPreview(file,{maxPixels:4096*4096});
    if(decoded.metadata.modality!==series.modality)
      throw Error("Снимок CXR не соответствует выбранной DICOM-серии.");
    const b64=decoded.url.split(",")[1];
    const original=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    if(checksum(original)!==report.sourcePngSha256)
      throw Error("Визуальная копия не совпала с исходным снимком, проверенным TorchXRayVision.");
    const limited=await downsampleReviewedCxr(decoded.url,controller.signal);
    if(!controller.signal.aborted){
      setPreview(limited);
      setStatus("Исходный снимок подтверждён. Локально очищаем PNG и проверяем надписи...");
    }
  })().catch(e=>{
    if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Кадр недоступен.");
  });
  return()=>controller.abort();
 },[series,files,report]);
 return <section className="cs-geometry" aria-label="Независимый Gemini Vision по рентгенограмме, затем Opus">
  <h3>Оригинальный снимок → независимый Gemini Vision → Opus</h3>
  <p>Gemini сначала увидит только обезличенный снимок. Числовые оценки
    TorchXRayVision ему не передаются. После независимого описания Opus
    получит шесть баллов и оценит совпадения, расхождения, проекцию AP/PA
    и возможное увеличение сердечной тени. Проекцию нельзя выдумывать.</p>
  {status&&<p role="status">{status}</p>}
  {error&&<p role="alert">{error} Облачная передача запрещена.</p>}
  {preview&&<VisionPrivacyPreparation key={report.sourcePngSha256}
    previews={previews} modality={series.modality}
    originalLocalFileIds={localIds}
    onOpenOriginalSlice={()=>onNavigate(0)}
    originalCxrEvidence={report} autoStartAfterDetectors={true}/>}
 </section>;
}
