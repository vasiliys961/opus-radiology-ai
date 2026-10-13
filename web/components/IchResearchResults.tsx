"use client";
import {useEffect,useRef,useState} from "react";
import {sha256} from "@noble/hashes/sha2.js";
import IchNativeOverlay from "./IchNativeOverlay";
import IchReferenceComparisonPanel from "./IchReferenceComparisonPanel";
import {
  parseIchResearchReport,buildIchLocalReview,
  type IchResearchReport,type IchReviewDecision
} from "../lib/ich-research";

type Decision={decision:IchReviewDecision;note:string};
const names:Record<IchReviewDecision,string>={
  unreviewed:"Не оценён",
  needs_source_review:"Требуется проверка по исходной КТ",
  rejected_by_reviewer:"Отклонён врачом (локальная отметка)",
};
async function matchFileSha(file:File,expected:string,signal:AbortSignal){
  if(file.size<1||file.size>512*1024*1024)throw Error("Файл должен быть от 1 байта до 512 МиБ.");
  const digest=sha256.create();
  for(let at=0;at<file.size;at+=2*1024*1024){
    if(signal.aborted)throw Error("Проверка отменена.");
    const chunk=await file.slice(at,Math.min(file.size,at+2*1024*1024)).arrayBuffer();
    digest.update(new Uint8Array(chunk));
  }
  if(signal.aborted)throw Error("Проверка отменена.");
  const actual=Array.from(digest.digest(),n=>n.toString(16).padStart(2,"0")).join("");
  if(actual!==expected)throw Error("SHA-256 не совпадает с исследовательским отчётом.");
}
function downloadReview(filename:string,data:unknown){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  const link=document.createElement("a");
  link.href=url;link.download=filename;document.body.appendChild(link);
  link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function IchResearchResults(){
  const [report,setReport]=useState<IchResearchReport|null>(null);
  const [sourceOk,setSourceOk]=useState(false);
  const [maskOk,setMaskOk]=useState(false);
  const [sourceFile,setSourceFile]=useState<File|null>(null);
  const [maskFile,setMaskFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [decisions,setDecisions]=useState<Record<number,Decision>>({});
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>()=>abort.current?.abort(),[]);
  function clear(){
    abort.current?.abort();abort.current=null;setReport(null);
    setMaskOk(false);setSourceOk(false);setSourceFile(null);setMaskFile(null);
    setDecisions({});setError("");
  }
  async function loadReport(file:File){
    clear();
    try{
      if(file.size>2*1024*1024)throw Error("Отчёт превышает 2 МиБ.");
      const validated=parseIchResearchReport(await file.text());
      setReport(validated);
    }catch(e){setError(e instanceof Error?e.message:"Некорректный исследовательский отчёт.");}
  }
  async function verify(file:File,kind:"source"|"mask"){
    if(!report)return;
    abort.current?.abort();
    const controller=new AbortController();
    abort.current=controller;
    setBusy(true);setError("");
    if(kind==="source"){setSourceOk(false);setSourceFile(null);}
    else {setMaskOk(false);setMaskFile(null);}
    try{
      await matchFileSha(file,kind==="source"?report.source.sha256:report.prediction.maskSha256,
        controller.signal);
      if(!controller.signal.aborted){
        if(kind==="source"){setSourceOk(true);setSourceFile(file);}
        else {setMaskOk(true);setMaskFile(file);}
      }
    }catch(e){
      if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Файл не совпадает.");
    }finally{
      if(abort.current===controller){abort.current=null;setBusy(false);}
    }
  }
  return <section aria-label="Результаты специализированной модели кровоизлияний"
    style={{padding:14,border:"1px solid #77928a",borderRadius:10,marginTop:18}}>
    <h3>Исследовательская сегментация кровоизлияний · SAMIHS</h3>
    <p>Импорт результата <strong>предобученного детектора</strong>, выполненного отдельно на
      разрешённой публичной 3D-КТ. Это <strong>не анализ текущей открытой DICOM-серии</strong>.
      Приложение не запускает модель на Mac и не отправляет изображения в интернет.</p>
    <label>JSON-отчёт реального запуска SAMIHS
      <input type="file" accept=".json,application/json" onChange={e=>{
        const file=e.target.files?.[0];e.currentTarget.value="";
        if(file)void loadReport(file);
      }}/>
    </label>
    {error&&<p role="alert">{error}</p>}
    {report&&<>
      <p role="alert"><strong>Не клинический диагноз.</strong> Имеющаяся модель возвращает
        бинарные кандидаты без типа кровоизлияния; источники и маски не привязаны
        к DICOM SOP UID. Отсутствие маски не означает отсутствие патологии.</p>
      <p>Модель: {report.model.id}. Применение весов заявлено во внешнем отчёте;
        подлинность инференса не доказана самим импортом JSON.</p>
      <p>Исходная 3D-КТ: {report.source.geometry.dimensions.join(" × ")} вокселей.
        Предсказанная маска: {report.prediction.predictedMaskVolumeMl.toFixed(2)} мл,
        {report.prediction.predictedPositiveVoxelCount} положительных вокселей.
        Компоненты связности: {report.prediction.connectedComponentsTotal}.</p>
      <p>Набор находок исследовательский. Dice, чувствительность и специфичность
        не рассчитаны на независимой выборке.</p>
      <div>
        <label>Исходный публичный NIfTI (.nii/.nii.gz) — SHA-256
          <input disabled={busy} type="file" accept=".nii,.gz,.nii.gz" onChange={e=>{
            const f=e.target.files?.[0];e.currentTarget.value="";
            if(f)void verify(f,"source");
          }}/>
        </label>
        <p role="status">Исходная КТ: {sourceOk?"SHA-256 совпал":"не подтверждена по файлу"}</p>
        <label>Бинарная маска SAMIHS (.nii/.nii.gz) — SHA-256
          <input disabled={busy} type="file" accept=".nii,.gz,.nii.gz" onChange={e=>{
            const f=e.target.files?.[0];e.currentTarget.value="";
            if(f)void verify(f,"mask");
          }}/>
        </label>
        <p role="status">Маска: {maskOk?"SHA-256 совпал":"не подтверждена по файлу"}</p>
      </div>
      {sourceOk&&maskOk&&sourceFile&&maskFile&&<>
        <IchNativeOverlay source={sourceFile} mask={maskFile} report={report}/>
        <IchReferenceComparisonPanel modelReport={report}/>
      </>}
      <p><small>SHA подтверждает соответствие выбранным локальным файлам,
        а не клиническую точность, правильность анатомии или доверие к автору отчёта.</small></p>
      {report.prediction.largestComponents.length===0?
        <p>Модель не сформировала кандидатов. <strong>Это не отрицательное заключение.</strong></p>:
        <div style={{maxHeight:420,overflowY:"auto"}}>
          {report.prediction.largestComponents.map(c=>{
            const current=decisions[c.componentIndex]??{decision:"unreviewed",note:""};
            return <fieldset key={c.componentIndex} style={{margin:"12px 0",padding:10}}>
              <legend><strong>Кандидат {c.componentIndex+1}</strong></legend>
              <p>Предложение модели: {c.volumeMl.toFixed(2)} мл;
                бокс в индексах исходного NIfTI: {c.boundsVoxelMin.join("/")}
                {" — "}{c.boundsVoxelMax.join("/")}. Не подтверждён как гематома.</p>
              <label>Врачебная оценка
                <select value={current.decision} onChange={e=>
                  setDecisions(prev=>({...prev,[c.componentIndex]:{
                    ...current,decision:e.target.value as IchReviewDecision
                  }}))}>
                  {Object.entries(names).map(([value,label])=>
                    <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label style={{display:"block"}}>Комментарий врача
                <textarea style={{display:"block",width:"100%"}} rows={2}
                  maxLength={1000} value={current.note}
                  onChange={e=>setDecisions(prev=>({...prev,
                    [c.componentIndex]:{...current,note:e.target.value}}))}/>
              </label>
            </fieldset>;
          })}
        </div>}
      <button type="button" disabled={!sourceOk||!maskOk||busy}
        onClick={()=>{try{
          downloadReview("opus-ich-physician-research-review.json",
            buildIchLocalReview(report,sourceOk,maskOk,decisions));setError("");
        }catch(e){setError(e instanceof Error?e.message:"Некорректный разбор.");}}}>
        Скачать локальный разбор с проверенными SHA-256
      </button>{" "}
      <button type="button" onClick={clear}>Закрыть исследовательский результат</button>
      <p><small>Проверка по SHA-256 обязательна для экспорта врачебной записи.
        Исходные пиксели и маска не копируются в JSON и не загружаются на сервер.
        Решения не удостоверены цифровой подписью.</small></p>
    </>}
  </section>;
}
