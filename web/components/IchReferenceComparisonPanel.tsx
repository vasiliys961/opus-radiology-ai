"use client";

import {useEffect,useRef,useState} from "react";
import {sha256} from "@noble/hashes/sha2.js";
import IchExpertErrorOverlay from "./IchExpertErrorOverlay";
import IchSliceEvidencePanel from "./IchSliceEvidencePanel";
import {
  parseIchReferenceComparison,type IchReferenceComparison,
} from "../lib/ich-reference-comparison";
import type {IchResearchReport} from "../lib/ich-research";

async function verifySha(file:File,expected:string,signal:AbortSignal){
  if(!file.size||file.size>512*1024*1024)
    throw Error("Файл экспертной разметки не должен превышать 512 МиБ.");
  const h=sha256.create();
  for(let i=0;i<file.size;i+=2*1024*1024){
    if(signal.aborted)throw Error("Проверка отменена.");
    h.update(new Uint8Array(await file.slice(i,Math.min(file.size,i+2*1024*1024)).arrayBuffer()));
  }
  if(signal.aborted)throw Error("Проверка отменена.");
  const actual=Array.from(h.digest(),x=>x.toString(16).padStart(2,"0")).join("");
  if(actual!==expected)throw Error("SHA-256 экспертной маски не совпадает.");
}
const num=(v:number|null,precision=3)=>v===null?"не рассчитан":v.toFixed(precision);
export default function IchReferenceComparisonPanel({modelReport,source,mask}:{
 modelReport:IchResearchReport;source:File;mask:File;
}){
 const [comparison,setComparison]=useState<IchReferenceComparison|null>(null);
 const [referenceVerified,setReferenceVerified]=useState(false);
 const [referenceFile,setReferenceFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const ctrl=useRef<AbortController|null>(null);
 useEffect(()=>()=>ctrl.current?.abort(),[]);
 function clear(){
   ctrl.current?.abort();ctrl.current=null;
   setComparison(null);setReferenceVerified(false);setReferenceFile(null);
   setBusy(false);setError("");
 }
 async function open(file:File){
   clear();
   try{
     if(!file.size||file.size>2*1024*1024)throw Error("Паспорт сравнения превышает 2 МиБ.");
     const value=parseIchReferenceComparison(await file.text(),modelReport);
     setComparison(value);
   }catch(e){setError(e instanceof Error?e.message:"Паспорт сравнения не принят.");}
 }
 async function verify(file:File){
   if(!comparison)return;
   ctrl.current?.abort();
   const current=new AbortController();
   ctrl.current=current;setReferenceVerified(false);setReferenceFile(null);
   setBusy(true);setError("");
   try{
     await verifySha(file,comparison.evidenceHashes.expertMaskSha256,current.signal);
     if(!current.signal.aborted){setReferenceFile(file);setReferenceVerified(true);}
   }catch(e){
     if(!current.signal.aborted)setError(e instanceof Error?e.message:"Неподходящая маска.");
   }finally{
     if(ctrl.current===current){ctrl.current=null;setBusy(false);}
   }
 }
 const m=comparison?.metrics;
 return <section aria-label="Количественная проверка кровоизлияния по экспертной маске"
   style={{border:"1px solid #95b4a8",padding:12,borderRadius:10,margin:"16px 0"}}>
   <h4>Врачебная проверка · сравнение с экспертной маской</h4>
   <p>Загрузите результат внешнего независимого расчёта
     <code> evaluate-ich-public-mask.py</code>. Оценка относится только к
     разрешённой публичной КТ и текущей маске SAMIHS.
     Не применяется к исследованию пациента из DICOM-просмотрщика.</p>
   <label>Паспорт сравнения JSON
     <input type="file" accept=".json,application/json" onChange={e=>{
       const file=e.target.files?.[0];e.currentTarget.value="";
       if(file)void open(file);
     }}/>
   </label>
   {error&&<p role="alert">{error}</p>}
   {comparison&&<>
     <p>Контроль источника и предсказанной маски: совпал с текущим исследованием.
       Экспертная разметка: метка {comparison.referenceLabel};
       проверка прав на использование заявлена автором внешнего отчёта,
       но не удостоверена этим приложением.</p>
     <label>Оригинальная экспертная маска (.nii / .nii.gz), проверка SHA-256
       <input disabled={busy} type="file" accept=".nii,.gz,.nii.gz" onChange={e=>{
         const file=e.target.files?.[0];e.currentTarget.value="";
         if(file)void verify(file);
       }}/>
     </label>
     {busy&&<p role="status">Проверка SHA-256 экспертной маски локально…</p>}
     {referenceVerified&&m&&<>
       <p role="status">SHA-256 экспертной маски совпал. Ниже представлены
         метрики внешнего вычисления, а не пересчёт в браузере.</p>
       <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
         <p><strong>Dice: {num(m.dice)}</strong></p>
         <p><strong>IoU: {num(m.iou)}</strong></p>
         <p><strong>HD95: {m.hd95Mm===null?"не рассчитан":num(m.hd95Mm,2)+" мм"}</strong></p>
       </div>
       <p>Предсказанный объём: {num(m.predictedVolumeMl,2)} мл.
         Эталонный объём: {num(m.expertMaskVolumeMl,2)} мл.
         Абсолютная ошибка объёма: {num(m.absoluteVolumeErrorMl,2)} мл.</p>
       <p>Воксельная полнота: {num(m.voxelRecall)}; точность по вокселям:
         {num(m.voxelPrecision)}. Эти показатели не являются
         клинической чувствительностью или специфичностью диагностики.</p>
       {m.hd95UnavailableReason&&<p><small>HD95 отсутствует:
         {m.hd95UnavailableReason}</small></p>}
       {m.bothMasksEmpty&&<p role="alert">Обе маски пусты.
         Это не доказательство здоровой КТ, Dice не определён.</p>}
       {referenceFile&&<IchExpertErrorOverlay
         source={source} mask={mask} expert={referenceFile}
         referenceLabel={comparison.referenceLabel} modelReport={modelReport}/>}
       <IchSliceEvidencePanel comparison={comparison} model={modelReport}/>
       <p><strong>Один исследовательский случай.</strong>
         Не доказано, что он не использовался при обучении модели.
         Не проверены независимость экспертной разметки,
         клиническая валидация и DICOM SOP-привязка.</p>
     </>}
     {!referenceVerified&&<p><small>Численные показатели скрыты,
       пока экспертный файл не совпал по SHA-256 с паспортом сравнения.</small></p>}
     <button type="button" onClick={clear}>Закрыть сравнение</button>
   </>}
 </section>;
}
