"use client";
import {useEffect,useState} from "react";
import type {DicomSeries,TechnicalDicomMetadata} from "../lib/dicom-series";
import {decodeDicomPreview} from "../lib/dicom-lite";
import {buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview,pngFromBase64} from "../lib/vision-privacy";
import {runCxrXrvFromOpenedDicom,toSafeXrvScores,XRV_CXR_LABELS,type OriginalXrvCxrResult} from "../lib/xrv-original-cxr";
import type {SanitizedModelReview} from "../lib/sanitized-cloud-review";

type Photo={id:string;file:File;url:string};
type Kind="CR"|"DX"|"IMG";
export type AnalysisView={id:string;file:File;modality:Kind;label:string;bodyRegion?:TechnicalDicomMetadata["bodyRegion"]};

async function rasterPng(url:string):Promise<string>{
 const image=new Image();
 image.decoding="async";
 image.src=url;
 await image.decode();
 if(image.width<32||image.height<32)throw Error("Снимок слишком маленький.");
 let width=image.width,height=image.height;
 for(let attempt=0;attempt<4;attempt++){
  const scale=Math.min(1,Math.sqrt((1024*1024)/(width*height)),1400/width,1400/height);
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.floor(width*scale));
  canvas.height=Math.max(1,Math.floor(height*scale));
  const context=canvas.getContext("2d");
  if(!context)throw Error("Не удалось подготовить снимок.");
  context.fillStyle="#000";
  context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const base64=canvas.toDataURL("image/png").split(",")[1];
  if(!base64)throw Error("Не удалось подготовить PNG.");
  if(base64.length<=1_700_000)return base64;
  width=Math.floor(width*0.7);height=Math.floor(height*0.7);
 }
 throw Error("Снимок не помещается в пакет для анализа.");
}

export default function PlainImageAnalysis({series,files,photos,views,autoStart=false}:{
 series?:DicomSeries;files?:ReadonlyMap<string,File>;photos?:Photo[];views?:AnalysisView[];autoStart?:boolean;
}){
 const [status,setStatus]=useState(autoStart?"Готовим снимки…":"");
 const [connected,setConnected]=useState<boolean|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [scores,setScores]=useState<OriginalXrvCxrResult|null>(null);
 const [report,setReport]=useState<SanitizedModelReview|null>(null);
 const sourceKey=(series?.key??"")+":"+(photos?.map(p=>p.id).join(",")??"")+":"+(views?.map(v=>v.id).join(",")??"");
 useEffect(()=>{setReport(null);setScores(null);setError("");setStatus(autoStart?"Готовим снимки…":"");},[sourceKey,autoStart]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch("/api/ai/deidentified-openrouter-review",{cache:"no-store",credentials:"same-origin",signal:controller.signal})
   .then(async r=>r.ok?r.json():null)
   .then(d=>{if(!controller.signal.aborted)setConnected(d?.enabled===true&&d?.workstationConnected===true);})
   .catch(()=>{if(!controller.signal.aborted)setConnected(false);});
  return()=>controller.abort();
 },[sourceKey]);
 async function analyze(){
  if(busy)return;
  setBusy(true);setError("");setReport(null);setScores(null);
  const controller=new AbortController();
  try{
   const frames:(File|{dicom:File})[]=[];
   if(views?.length){
    if(views.length>4)throw Error("За один раз разбираются не больше четырёх проекций.");
    for(const view of views)frames.push(view.modality==="IMG"?view.file:{dicom:view.file});
   }else if(series&&files){
    if(!["CR","DX"].includes(series.modality)||series.members.length<1||series.members.length>4)
     throw Error("Нужна одна или несколько рентгенограмм CR/DX, не больше четырёх.");
    for(const member of series.members){
     const file=files.get(member.id);
     if(!file)throw Error("Исходный DICOM больше недоступен.");
     frames.push({dicom:file});
    }
   }else if(photos?.length){
    if(photos.length>4)throw Error("За один раз разбираются не больше четырёх снимков.");
    frames.push(...photos.map(p=>p.file));
   }else throw Error("Нет снимка для анализа.");
   setStatus("Готовим копии без служебных данных…");
   const modality:Kind=views?.[0]?.modality??(series?.modality==="CR"||series?.modality==="DX"?series.modality:"IMG");
   const prepared=[];
   for(let i=0;i<frames.length;i++){
    const item=frames[i];
    const url="dicom" in item?(await decodeDicomPreview(item.dicom,{maxPixels:4096*4096})).url:URL.createObjectURL(item);
    try{prepared.push(await rasterPng(url));}
    finally{if(!("dicom" in item))URL.revokeObjectURL(url);}
   }
   let cxr:OriginalXrvCxrResult|null=null;
   const singleView=views?.length===1?views[0]:null;
   const chestFile=singleView&&singleView.modality!=="IMG"&&(singleView.bodyRegion==="CHEST"||singleView.bodyRegion==null)
    ?singleView.file
    :!views&&series?.members.length===1&&files&&(series.members[0].metadata.bodyRegion==="CHEST"||series.members[0].metadata.bodyRegion==null)
     ?files.get(series.members[0].id):undefined;
   if(chestFile){
    const file=chestFile;
    if(file){
     try{cxr=await runCxrXrvFromOpenedDicom(file,controller.signal,setStatus);setScores(cxr);}
     catch{setStatus("Служба шести признаков не ответила. Снимок всё равно разбирают Gemini и Opus.");}
    }
   }
   const packet=buildVisionPrivacyPacket(prepared.map((base64,i)=>markPrivacyReview(markPrivacyReview(
    createPrivacyFrame(pngFromBase64(base64),`frame-${i+1}`,modality),"pixel",true),"visual",true)),crypto.randomUUID());
   setStatus("Отправляем снимки в подключённые Gemini и Opus…");
   const ready=await fetch("/api/ai/deidentified-openrouter-review",{cache:"no-store",credentials:"same-origin",signal:controller.signal});
   const readiness:unknown=ready.ok?await ready.json():null;
   const live=!!readiness&&typeof readiness==="object"&&(readiness as {enabled?:boolean;workstationConnected?:boolean}).enabled===true&&
    (readiness as {workstationConnected?:boolean}).workstationConnected===true;
   setConnected(live);
   if(!live)throw Error("Локальный сервер не подтвердил сеанс Gemini и Opus. Проверка подключения на технической панели.");
   const response=await fetch("/api/ai/deidentified-openrouter-review",{
    method:"POST",cache:"no-store",credentials:"same-origin",signal:controller.signal,
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({packet,acknowledgeClinicianLawfulDisclosure:true,acknowledgeProviderHealthDataTerms:true,
     acknowledgePixelIdentityReviewed:true,acknowledgeTwoPaidCalls:true,
     ...(cxr?{cxrModelEvidence:toSafeXrvScores(cxr)}:{})}),
   });
   const body:unknown=await response.json();
   if(!response.ok)throw Error((body as {error?:string}).error??"Анализ не выполнен.");
   const doc=body as SanitizedModelReview;
   if(doc.schema!=="opus-sanitized-cloud-pilot/v1"||doc.results?.length!==2)
    throw Error("Ответ анализа не разобран.");
   setReport(doc);
   setStatus("Готово. Врач сверяет текст с исходным снимком.");
  }catch(e){
   if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Анализ не выполнен.");
  }finally{setBusy(false);}
 }
 useEffect(()=>{if(autoStart)void analyze();},[autoStart,sourceKey]);
 const gemini=report?.results.find(r=>r.reviewer==="gemini")?.review;
 const text=report?.opusSynthesis?.summary;
 return <section className="cs-geometry" aria-label="Анализ рентгенограммы или снимка">
  <h3>{views&&views.length>1?"Разбор выбранных проекций":series?"Рентгенограмма":"Снимок PNG или JPEG"}</h3>
  <p role="status">{connected===null?"Проверяем Gemini и Opus…":connected?"Gemini и Opus подключены. Снимок уходит им.":"Сеанс Gemini и Opus сейчас не подтверждён."}</p>
  {!autoStart&&<button type="button" className="cs-analyze" disabled={busy} onClick={()=>void analyze()}>{busy?"Анализ выполняется…":views&&views.length>1?"Анализировать выбранные проекции":"Анализировать снимок"}</button>}
  {status&&<p role="status">{status}</p>}
  {error&&<p role="alert">{error}</p>}
  {scores&&<div>{XRV_CXR_LABELS.map(label=><p key={label}><strong>{label}</strong>: {scores.labels[label].toFixed(3)}</p>)}
   <p>Это некалиброванные выходы одной модели. Низкое значение не исключает находку.</p></div>}
  {gemini&&<div><h3>Gemini</h3>{gemini.observations.map(item=><p key={item.id}><strong>{item.anatomy}.</strong> {item.sign} {item.uncertainty}</p>)}
   {gemini.limitations.map(item=><p key={item}>{item}</p>)}</div>}
  {text&&<div><h3>Заключение Opus</h3><p style={{whiteSpace:"pre-wrap"}}>{text}</p></div>}
 </section>;
}
