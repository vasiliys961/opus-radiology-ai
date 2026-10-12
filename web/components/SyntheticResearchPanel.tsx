"use client";

import {useEffect, useRef, useState} from "react";
import type {ProviderReadinessReport} from "../lib/provider-readiness";
import type {SyntheticTrialResult} from "../lib/synthetic-live-research";
import type {SyntheticRegion} from "../lib/synthetic-vision-phantom";
import {useAnalysisSound} from "./AnalysisSoundProvider";

type Props = {
  diagnostic: ProviderReadinessReport;
  selectedVision:string;selectedClinical:string;
};
const REGIONS: {id:SyntheticRegion; label:string}[] = [
  {id:"head",label:"Голова"},
  {id:"chest",label:"Грудная клетка"},
  {id:"abdomen",label:"Живот"},
];
export default function SyntheticResearchPanel({diagnostic,selectedVision:visionModel,selectedClinical:clinicalModel}:Props) {
  const visionModels=diagnostic.suggestions.vision;
  const clinicalModels=diagnostic.suggestions.clinical;
  const available=visionModels.some(m=>m.id===visionModel)&&clinicalModels.some(m=>m.id===clinicalModel);
  const gateway=diagnostic.provider==="polza"?"Polza":"OpenRouter";
  const [modality,setModality]=useState<"CT"|"MR">("CT");
  const [region,setRegion]=useState<SyntheticRegion>("chest");
  const [acknowledged,setAcknowledged]=useState(false);
  const [working,setWorking]=useState(false);
  const [result,setResult]=useState<SyntheticTrialResult|null>(null);
  const [error,setError]=useState("");
  const [expanded,setExpanded]=useState(false);
  const generation=useRef(0),active=useRef<AbortController|null>(null);
  const {enabled:chimeEnabled,armChime,completionChime}=useAnalysisSound();
  useEffect(()=>{
    ++generation.current;
    setResult(null);setError("");setAcknowledged(false);
    return ()=>{++generation.current;active.current?.abort();};
  },[visionModel,clinicalModel,modality,region,diagnostic.provider]);
  const run = async () => {
    if(working || !acknowledged || !available) return;
    if(chimeEnabled) void armChime();
    setWorking(true);setResult(null);setError("");
    const controller=new AbortController();
    active.current=controller;const version=generation.current;
    const timeout=setTimeout(()=>controller.abort(),265_000);
    try {
      const response=await fetch("/api/ai/synthetic-demo",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        cache:"no-store",signal:controller.signal,
        body:JSON.stringify({
          provider:diagnostic.provider,modality,region,visionModel,clinicalModel,
          acknowledgePaidSyntheticExperiment:true,
        }),
      });
      const payload:unknown=await response.json();
      if(version!==generation.current)return;
      if(!response.ok) {
        const message=payload && typeof payload==="object" &&
          typeof (payload as {error?:unknown}).error==="string" ?
            String((payload as {error:string}).error).slice(0,240) :
            "HTTP "+response.status;
        throw new Error(message);
      }
      if(!payload || typeof payload!=="object" ||
          (payload as {schema?:unknown}).schema!=="opus-synthetic-trial/v1" ||
          (payload as {sample?:unknown}).sample!=="non-patient-mathematical-phantom" ||
          (payload as {patientDataSubmitted?:unknown}).patientDataSubmitted!==false ||
          (payload as {region?:unknown}).region!==region ||
          (payload as {remoteInferencePerformed?:unknown}).remoteInferencePerformed!==true ||
          (payload as SyntheticTrialResult).result?.provider!==diagnostic.provider ||
          (payload as SyntheticTrialResult).result?.visionModel!==visionModel ||
          (payload as SyntheticTrialResult).result?.clinicalModel!==clinicalModel ||
          (payload as {result?: {clinicalStatus?:unknown}}).result?.clinicalStatus!==
            "unverified_research_draft") {
        throw new Error("Ответ не соответствует исследовательскому контракту.");
      }
      setResult(payload as SyntheticTrialResult);
      void completionChime();
    } catch(err) {
      if(version===generation.current)setError(controller.signal.aborted?
        "Тест отменён или время ожидания истекло. Уже выполненные обращения могут быть оплачены.":
        err instanceof Error ? err.message.slice(0,280) : "Исследовательский вызов не удался.");
    } finally {
      clearTimeout(timeout);if(active.current===controller)active.current=null;setWorking(false);
    }
  };
  const download = () => {
    if(!result) return;
    const bytes=JSON.stringify(result,null,2);
    const blob=new Blob([bytes],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="opus-synthetic-orchestra-"+modality.toLowerCase()+"-"+region+".json";
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),400);
  };
  if(diagnostic.catalogStatus!=="verified-response" || !diagnostic.keyConfigured) return null;
  return <section className="ora-synthetic-demo" aria-label={`Эксперимент ${gateway} с искусственными изображениями`}>
    <div className="ora-v17-heading"><strong>Пробный анализ через настоящие AI-модели</strong>
      <span>Только искусственные изображения</span></div>
    <p className="ora-synthetic-lead">5 вызовов {gateway}: три роли выбранной Vision-модели,
      затем выбранный оценщик проверяет кадры и готовит текстовый синтез. Отправляются только математические PNG-фантомы,
      созданные на сервере. Загруженные DICOM и клинический контекст не используются.</p>
    <div className="ora-synthetic-controls">
      <label htmlFor="ora-synthetic-region">Область
        <select id="ora-synthetic-region" value={region} disabled={working}
          onChange={event=>setRegion(event.target.value as SyntheticRegion)}>
          {REGIONS.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label htmlFor="ora-synthetic-modality">Условная модальность
        <select id="ora-synthetic-modality" value={modality} disabled={working}
          onChange={event=>setModality(event.target.value as "CT"|"MR")}>
          <option value="CT">КТ — схематическая</option>
          <option value="MR">МРТ — схематическая</option>
        </select>
      </label>
      <p>Vision: <code>{visionModel}</code>. Оценщик и синтез: <code>{clinicalModel}</code>.
        Выбор моделей — в AI-оркестре выше.</p>
    </div>
    {!available&&<p role="status">Выбранная связка отсутствует в проверенном каталоге {gateway} или не поддерживает изображения и текст.
      Запуск заблокирован. Другая модель автоматически не выбирается.</p>}
    <div className="ora-synthetic-preview" aria-label="Точные синтетические изображения для AI">
      {[0,1].map(index=><figure key={index}>
        <img alt={"Математический фантом "+(index+1)+", "+region+", не DICOM"}
          src={"/api/ai/synthetic-demo/preview?region="+region+
            "&modality="+modality+"&frame="+index}/>
        <figcaption>Искусственный кадр {index+1}/2 · 96×96</figcaption>
      </figure>)}
    </div>
    <p className="ora-synthetic-warning">Это платный эксперимент: {gateway} может списать средства
      за 5 обращений, включая неудачные. Показанные каталожные модели могут быть
      недоступны на вашем тарифе. Установите лимит расходов у выбранного шлюза.</p>
    <label className="ora-synthetic-accept" htmlFor="ora-synthetic-cost-ack">
      <input id="ora-synthetic-cost-ack" type="checkbox" checked={acknowledged}
        disabled={working} onChange={e=>setAcknowledged(e.target.checked)}/>
      Подтверждаю платный тест исключительно на искусственных изображениях.
    </label>
    <button type="button" className="ora-synthetic-run" disabled={
      working || !acknowledged || !available
    } onClick={()=>{void run();}}>
      {working ? "Модели анализируют фантомы… до 4 минут" :
        `Запустить реальный ${gateway}-тест`}
    </button>
    {working&&<button type="button" onClick={()=>active.current?.abort()}>Отменить тест</button>}
    {working && <p role="status" className="ora-synthetic-status">
      Запрос отправлен. Не закрывайте вкладку. Повторный запуск заблокирован.
      Если соединение оборвётся, ранее выполненные вызовы могут быть оплачены.
    </p>}
    {error && <p role="alert" className="ora-provider-error">
      Тест не завершён: {error}. «Дзинь» не воспроизводится при ошибке.
    </p>}
    {result && <div className="ora-synthetic-result" aria-live="polite">
      <div className="ora-synthetic-complete"><strong>✓ Оркестр ответил</strong>
        <span>5 этапов · {result.region} · {result.result.modality}</span></div>
      <p className="ora-synthetic-warning">НЕ клиническое заключение. Модели смотрели
        геометрические фантомы 96×96 пикселей, не медицинские изображения.</p>
      <div className="ora-synthetic-metrics">
        <div><b>{result.result.roleResponses.length}</b><small>Vision-роли</small></div>
        <div><b>{result.result.evidence.findings.length}</b><small>Наблюдения (невериф.)</small></div>
        <div><b>{result.result.critic.needsRecheck.length}</b><small>Повторная проверка</small></div>
      </div>
      <h3>Исследовательский текст</h3>
      <p>{result.result.clinicalDraft.summary}</p>
      {result.result.clinicalDraft.limitations.length>0 && <ul>{
        result.result.clinicalDraft.limitations.map((item,i)=><li key={i}>{item}</li>)
      }</ul>}
      <button type="button" className="ora-synthetic-secondary"
        aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
        {expanded ? "Скрыть ответы агентов" : "Показать ответы агентов и доказательства"}
      </button>
      {expanded && <div className="ora-synthetic-details">
        {result.result.roleResponses.map(role=><div key={role.role}>
          <strong>{role.role} · обработано {role.reviewedImageIds.length} кадров</strong>
          {role.observations.map(item=><p key={item.id}>
            {item.anatomy}: {item.sign} · неопределённость: {item.uncertainty}
          </p>)}
          {role.limitations.map((note,i)=><small key={i}>{note}</small>)}
        </div>)}
        <div><strong>Критик · {result.result.clinicalModel}</strong>
          <p>Противоречия: {result.result.critic.conflicts.join(", ") || "Не указаны"}</p>
          {result.result.critic.limitations.map((note,i)=><small key={i}>{note}</small>)}
        </div>
        <div><strong>Evidence JSON · источник каждого наблюдения</strong>
          {result.result.evidence.findings.map(f=><p key={f.findingId}>
            {f.findingId}: {f.status}, SOP={f.source.sopInstanceUid ?? "не задан"}
          </p>)}
        </div>
      </div>}
      <button type="button" className="ora-synthetic-secondary" onClick={download}>
        Сохранить исследовательский JSON
      </button>
      <p className="ora-synthetic-note">В ответе нет пикселей и API-ключа. Модели могут
        галлюцинировать даже на математических изображениях. Пациентский AI пока отключён.</p>
    </div>}
    <p className="ora-synthetic-note">Работает только на localhost в режиме npm run dev.
      Переход на реальный DICOM-поток потребует проверки обезличивания, авторизации,
      согласия и происхождения каждого пикселя.</p>
  </section>;
}
