"use client";

import {useEffect,useRef,useState} from "react";
import {sha256} from "@noble/hashes/sha2.js";
import type {IchReferenceComparison} from "../lib/ich-reference-comparison";
import type {IchResearchReport} from "../lib/ich-research";
import {
 parseIchExpertSubtypeCoverage,type IchExpertSubtypeCoverage
} from "../lib/ich-subtype-coverage";

async function matchSha(file:File,expected:string,limit:number,signal:AbortSignal){
 if(!file.size||file.size>limit)throw Error("Неверный размер оригинального файла.");
 const hash=sha256.create();
 for(let offset=0;offset<file.size;offset+=1024*1024){
   if(signal.aborted)throw Error("Чтение отменено.");
   hash.update(new Uint8Array(await file.slice(offset,Math.min(offset+1024*1024,file.size)).arrayBuffer()));
 }
 if(signal.aborted)throw Error("Чтение отменено.");
 const digest=Array.from(hash.digest(),v=>v.toString(16).padStart(2,"0")).join("");
 if(digest!==expected)throw Error("SHA-256 оригинального файла не соответствует паспорту классов.");
}

export default function IchExpertSubtypeCoveragePanel({comparison,model}:{
 comparison:IchReferenceComparison;model:IchResearchReport;
}){
 const [report,setReport]=useState<IchExpertSubtypeCoverage|null>(null);
 const [originalOk,setOriginalOk]=useState(false);
 const [ontologyOk,setOntologyOk]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const abort=useRef<AbortController|null>(null);
 useEffect(()=>()=>abort.current?.abort(),[]);
 function reset(){
   abort.current?.abort();
   abort.current=null;
   setReport(null);setOriginalOk(false);setOntologyOk(false);setBusy(false);setError("");
 }
 async function readReport(file:File){
   reset();
   try{
     if(!file.size||file.size>1024*1024)throw Error("Паспорт превышает 1 МиБ.");
     setReport(parseIchExpertSubtypeCoverage(await file.text(),comparison,model));
   }catch(e){setError(e instanceof Error?e.message:"Паспорт классов не принят.");}
 }
 async function verify(file:File,kind:"original"|"ontology"){
   if(!report)return;
   abort.current?.abort();
   const controller=new AbortController();
   abort.current=controller;
   setBusy(true);setError("");
   if(kind==="original")setOriginalOk(false);else setOntologyOk(false);
   try{
     await matchSha(file,kind==="original"?report.evidenceHashes.originalExpertMaskSha256:
       report.evidenceHashes.ontologySha256,
       kind==="original"?512*1024*1024:64*1024,controller.signal);
     if(!controller.signal.aborted){
       if(kind==="original")setOriginalOk(true);else setOntologyOk(true);
     }
   }catch(e){
     if(!controller.signal.aborted)setError(e instanceof Error?e.message:"SHA не совпал.");
   }finally{
     if(abort.current===controller){abort.current=null;setBusy(false);}
   }
 }
 const rows=[...(report?.expertVoxelClasses??[])].sort(
   (a,b)=>b.modelMissedExpertVoxels-a.modelMissedExpertVoxels);
 return <section aria-label="Покрытие исходных экспертных типов кровоизлияния"
   style={{margin:"16px 0",padding:12,border:"1px solid #97b9a9",borderRadius:8}}>
   <h5>Какие экспертные типы кровоизлияния покрыты SAMIHS?</h5>
   <p>Загрузите паспорт из <code>ich-expert-subtype-coverage.py</code>, созданный
     единым исполнителем реального исследования. Это не классификация модели,
     а подсчёт покрытых и пропущенных вокселей оригинальной многоклассовой разметки.</p>
   <label>Паспорт классов (JSON)
     <input type="file" accept=".json,application/json" onChange={e=>{
       const file=e.target.files?.[0];e.currentTarget.value="";
       if(file)void readReport(file);
     }}/>
   </label>
   {error&&<p role="alert">{error}</p>}
   {report&&<>
     <p>Паспорт согласован с SHA исходной КТ, SAMIHS-маски, бинарного эталона
       и с проверенными независимыми 3D TP/FN. Для показа значений
       подтвердите два исходных исследовательских файла:</p>
     <label>Неизменённая оригинальная многоклассовая экспертная маска
       <input type="file" disabled={busy} accept=".nii,.nii.gz,.gz" onChange={e=>{
         const file=e.target.files?.[0];e.currentTarget.value="";
         if(file)void verify(file,"original");
       }}/>
     </label>
     <label>Онтология исходного набора данных (JSON)
       <input type="file" disabled={busy} accept=".json,application/json" onChange={e=>{
         const file=e.target.files?.[0];e.currentTarget.value="";
         if(file)void verify(file,"ontology");
       }}/>
     </label>
     <p role="status">Оригинальная разметка: {originalOk?"SHA подтверждён":"не подтверждена"}.
       Онтология: {ontologyOk?"SHA подтверждён":"не подтверждена"}.</p>
     {busy&&<p role="status">Локальная проверка SHA-256 без отправки данных…</p>}
     {originalOk&&ontologyOk&&<>
       <p role="status">Обе исходные контрольные суммы совпали. Ниже представлены
         значения внешнего независимого расчёта, связанные с настоящими файлами.</p>
       <div style={{overflowX:"auto"}}>
         <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
           <thead><tr><th>Тип по эксперту</th><th>Объём эксперта</th>
             <th>Покрыто SAMIHS</th><th>Пропущено (FN)</th><th>Воксельное покрытие</th></tr></thead>
           <tbody>{rows.map(x=><tr key={x.sourceLabel}>
             <td>{x.expertSubtype} (метка {x.sourceLabel})</td>
             <td>{x.expertVolumeMl.toFixed(3)} мл</td>
             <td>{x.modelOverlappingExpertVoxels} вокс.</td>
             <td><strong>{x.modelMissedExpertVoxels}</strong> вокс.</td>
             <td>{x.voxelCoverageFraction===null?"Нет эталонных вокселей":
                 (100*x.voxelCoverageFraction).toFixed(1)+"%"}</td>
           </tr>)}</tbody>
         </table>
       </div>
       <p>Всего экспертных вокселей: {report.totalExpertVoxels}.
         Совпавших с бинарной маской: {report.totalOverlappingExpertVoxels}.
         Пропущено: {report.totalMissedExpertVoxels}.</p>
       <p><small>Онтология заявлена исследовательским датасетом:
         {report.ontologySourceUrl}. SHA совпадает, однако это не независимый
         юридический аудит лицензии или подлинности экспертной аннотации.</small></p>
     </>}
     <p><small>Классы взяты исключительно из оригинальной разметки, не предсказаны
       SAMIHS. Воксельное покрытие не равно чувствительности к очагам или диагнозу.
       Отсутствие кандидата не исключает кровоизлияние.</small></p>
     <button type="button" onClick={reset}>Закрыть анализ классов</button>
   </>}
 </section>;
}
