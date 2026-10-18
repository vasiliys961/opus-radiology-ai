"use client";

import {useEffect,useState} from "react";
import type {PublicResearchCase,PublicLLMReview,PublicCaseId} from "../../lib/public-case-evidence";
import "./clinical-lab.css";

type IndexResponse={cases:PublicResearchCase[];paidLlmEnabled:boolean;model:string};
type ReviewResponse={caseData:PublicResearchCase;review:PublicLLMReview;model:string;provider:string;
  remoteInferencePerformed:true;patientDataSubmitted:false;clinicalStatus:"unverified_research_draft"};
const available=[
 {title:"Lungmask R231",status:"LIVE · LOCAL",description:"Настоящая сегментация правого/левого лёгкого из основной рабочей станции через отдельный CPU worker. Не является детектором узлов, опухолей и ILD.",href:"/"},
 {title:"MONAI RetinaNet",status:"PUBLIC CASE · RESEARCH",description:"Обученный локализующий детектор узлов. Проверено на одной публичной КТ LUNA16; доступен локальный экспорт DICOM→NIfTI, а исполнение модели — на отдельном Linux CPU.",href:"/viewer"},
 {title:"ianpan + TotalSegmentator",status:"PUBLIC CASE · RESEARCH",description:"Два настоящих детектора кровоизлияний на одной публичной КТ. Экспертной маски крови и клинических метрик нет.",href:"/"},
 {title:"TotalSegmentator · выпоты / органы",status:"PRETRAINED · PUBLIC CASE",description:"Настоящий task315 на публичной КТ: перикардиальная маска 32,075 мл (не подтверждённый диагноз). Прямой анализ произвольной DICOM КТ пока не подключён.",href:"/viewer"},
];
export default function ClinicalLab(){
  const [index,setIndex]=useState<IndexResponse|null>(null);
  const [caseId,setCaseId]=useState<PublicCaseId>("lung-nodule");
  const [provider,setProvider]=useState<"openrouter"|"polza">("openrouter");
  const [accepted,setAccepted]=useState(false);
  const [review,setReview]=useState<ReviewResponse|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/ai/public-evidence-review",{method:"GET",headers:{"Accept":"application/json"},signal:controller.signal,cache:"no-store"})
      .then(async res=>{if(!res.ok)throw Error("Каталог доступен только в локальном режиме разработки");return res.json() as Promise<IndexResponse>;})
      .then(value=>{if(!controller.signal.aborted)setIndex(value);})
      .catch(()=>{if(!controller.signal.aborted)setError("Каталог проверенных публичных примеров недоступен.");});
    return ()=>controller.abort();
  },[]);
  const selected=index?.cases.find(item=>item.caseId===caseId);
  async function askLLM(){
    if(!selected||!index?.paidLlmEnabled||!accepted||busy)return;
    setBusy(true);setError("");setReview(null);
    try{
      const response=await fetch("/api/ai/public-evidence-review",{
        method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({caseId,provider,acknowledgePaidPublicResearch:true}),
      });
      const result:unknown=await response.json();
      if(!response.ok)throw Error((result as {error?:string}).error??"Ошибка провайдера");
      const checked=result as ReviewResponse;
      if(checked.caseData?.caseId!==caseId||checked.patientDataSubmitted!==false||
         checked.clinicalStatus!=="unverified_research_draft"||
         !Array.isArray(checked.review?.rankedFacts))throw Error("Ответ не прошёл проверку");
      setReview(checked);
    }catch(e){setError(e instanceof Error?e.message:"Ошибка LLM");}
    finally{setBusy(false);}
  }
  return <main className="cl-page">
    <nav className="cl-top"><a href="/">← OPUS RADIOLOGY AI</a><span>Клиническая лаборатория · исследовательский режим</span></nav>
    <section className="cl-wrap">
      <header className="cl-hero">
        <span>ПАТОЛОГИЧЕСКИЕ МОДЕЛИ · ЧЕСТНЫЙ СТАТУС</span>
        <h1>Детекторы и AI-доказательства</h1>
        <p>Здесь показано, какие обученные модели действительно запускаются, и что получено на оригинальных публичных исследованиях. Предзаписанные примеры никогда не являются анализом DICOM, открытого сейчас врачом.</p>
      </header>
      <div className="cl-detectors">
        {available.map(a=><article className="cl-detector" key={a.title}>
          <small>{a.status}</small><h2>{a.title}</h2><p>{a.description}</p>
          <a href={a.href}>{a.status.startsWith("LIVE")?"Открыть рабочую станцию":"Открыть исследовательский интерфейс"} →</a>
        </article>)}
      </div>
      <section className="cl-panel">
        <h2>Доказательства настоящих моделей</h2>
        <p>Данные подготовлены из оригинальных числовых отчётов GitHub Actions. Они не содержат изображений пациента и не создают новую находку.</p>
        <div className="cl-toggle">
          <button type="button" className={caseId==="lung-nodule"?"active":""} onClick={()=>{setCaseId("lung-nodule");setAccepted(false);setReview(null);setError("");}}>КТ лёгких · узел</button>
          <button type="button" className={caseId==="head-hemorrhage"?"active":""} onClick={()=>{setCaseId("head-hemorrhage");setAccepted(false);setReview(null);setError("");}}>КТ головы · кровоизлияние</button>
          <button type="button" className={caseId==="chest-effusion"?"active":""} onClick={()=>{setCaseId("chest-effusion");setAccepted(false);setReview(null);setError("");}}>КТ грудной клетки · выпоты</button>
        </div>
        {selected?<div className="cl-case">
          <h3>{selected.title}</h3>
          <p><b>Модели:</b> {selected.modelNames.join(" + ")}</p>
          <ul>{selected.facts.map(f=><li key={f.id}><b>{f.label}.</b> {f.detail}</li>)}</ul>
          <div className="cl-warning"><strong>Нет клинической валидации.</strong>
            <ul>{selected.limitations.map(s=><li key={s}>{s}</li>)}</ul>
          </div>
          <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Оригинальный GitHub Actions отчёт ↗</a>
        </div>:<p>Проверка закреплённых исследовательских файлов…</p>}
      </section>
      <section className="cl-panel">
        <h2>LLM · исследовательский эксперт доказательств</h2>
        <p>Дополнительный Claude анализирует только проверенные числовые факты выбранного <b>публичного</b> случая, отмечает спорные места и вопросы для врача. Он <b>не видит КТ-пиксели</b>, не диагностирует пациента и не подменяет детекторы. Данные загруженных в Opus исследований никогда не передаются.</p>
        <div className="cl-llm">
          <label>Провайдер <select value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value as "polza"|"openrouter");setReview(null);setAccepted(false);}}><option value="openrouter">OpenRouter</option><option value="polza">Polza</option></select></label>
          <span>Модель: {index?.model??"проверка"} · 1 платный текстовый запрос</span>
          <label className="cl-accept"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/>Я подтверждаю возможную стоимость одного LLM-запроса на публичных непациентских данных.</label>
          <button type="button" disabled={!selected||!index?.paidLlmEnabled||!accepted||busy} onClick={()=>void askLLM()}>{busy?"Запрос к провайдеру…":"Провести LLM-критический разбор"}</button>
          {!index?.paidLlmEnabled&&<p className="cl-muted">Для реального вызова нужен локальный dev-сервер, API-ключ выбранного провайдера и серверный флаг RADIOLOGY_ENABLE_PUBLIC_EVIDENCE_LLM=1. По умолчанию платные запросы отключены.</p>}
        </div>
        {error&&<p role="alert" className="cl-error">{error}</p>}
        {review&&<div className="cl-case" aria-label="Результат LLM">
          <p><b>LLM-черновик · не диагноз:</b> {review.review.summary}</p>
          {review.review.rankedFacts.map(f=>{
            const known=review.caseData.facts.find(x=>x.id===f.factId);
            return <div key={f.factId} className="cl-review-row"><strong>{known?.label??f.factId} · {f.priority}</strong><p>{f.reason}</p></div>;
          })}
          <h3>Что остаётся проверить</h3>
          <ul>{review.review.unresolvedQuestions.map((s,i)=><li key={i}>{s}</li>)}</ul>
          <p className="cl-muted">Интерпретация LLM не проверена независимым врачом, не является источником дополнительных патологических находок.</p>
        </div>}
      </section>
    </section>
  </main>;
}
