"use client";
import { useEffect, useRef, useState } from "react";
import { type EvidenceDecision, type SegmentationEvidence } from "../lib/segmentation-evidence";
import { changeEvidenceReview, MAX_REVIEW_JSON_BYTES, restoreEvidenceReview, startEvidenceReview } from "../lib/evidence-review-history";
import type { Point3 } from "../lib/segmentation-mask";
import EvidenceComparisonReview from "./EvidenceComparisonReview";
const decisionLabel: Record<EvidenceDecision,string>={unreviewed:"Не проверено врачом",requires_recheck:"На перепроверку",rejected:"Отклонено локально"};

/** Mount with a binding key so replacement/series changes discard old reviews. */
export default function SegmentationEvidenceReview({evidence,onNavigate,onSampleMask}: {
  evidence: SegmentationEvidence; onNavigate: (point: Point3,labelId: number | null)=>void;
  onSampleMask: (point: Point3)=>number | null;
}) {
  const [review,setReview]=useState(()=>startEvidenceReview(evidence));
  const [error,setError]=useState("");
  const [historyError,setHistoryError]=useState("");
  const [imported,setImported]=useState(false);
  const importVersion=useRef(0);
  useEffect(()=>()=>{++importVersion.current;},[]);
  const decide=(id:string,decision:EvidenceDecision)=>{
    ++importVersion.current; // a pending import cannot replace a newer click
    try {setReview(changeEvidenceReview(review,id,decision,new Date().toISOString()));setHistoryError("");setImported(false);}
    catch(e) {setHistoryError(e instanceof Error?e.message:"Не удалось изменить отметку.");}
  };
  const restore=async(file?:File)=>{
    const version=++importVersion.current;if(!file)return;
    try {
      if(file.size>MAX_REVIEW_JSON_BYTES)throw new Error("История превышает лимит 256 КБ.");
      const raw=await file.text();if(version!==importVersion.current)return;
      setReview(restoreEvidenceReview(review,raw));setHistoryError("");setImported(true);
    }catch(e){if(version===importVersion.current)setHistoryError(e instanceof Error?e.message:"Не удалось восстановить историю.");}
  };
  const download=(value:unknown,suffix:string)=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`opus-${review.source.requestId}.${suffix}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="ora-evidence-panel ora-segmentation-evidence" aria-label="Evidence сегментации">
    <header className="ora-evidence-heading"><div><h2>Evidence · результат сегментации</h2>
      <p>{review.producer.model.id} · {review.producer.model.version} · {review.source.frameCount} загруженных срезов</p></div>
      <span className="ora-evidence-experimental">RESEARCH</span></header>
    <p className="ora-evidence-explainer">Объём метки рассчитан по маске и её геометрии только в загруженных срезах. Полнота органа не подтверждена. Это не поиск патологий и не диагноз.</p>
    {error&&<p role="alert" className="ora-evidence-error">{error}</p>}
    <ul className="ora-evidence-list">{review.observations.map(o=><li key={o.observationId}>
      <div className="ora-evidence-entry"><strong>{o.labelName}</strong><span>{decisionLabel[o.review]}</span></div>
      <p>{o.volumeMl.toFixed(3)} мл разметки · {o.voxels.toLocaleString("ru-RU")} вокселей</p>
      <div className="ora-evidence-row">
        <button type="button" onClick={()=>{try{onNavigate(o.anchorLpsMm,o.labelId);setError("");}catch{setError("Не удалось перейти к метке: проверьте активную серию MPR.");}}}>Показать метку в MPR</button>
        <button type="button" aria-pressed={o.review==="requires_recheck"} onClick={()=>decide(o.observationId,"requires_recheck")}>Перепроверить метку</button>
        <button type="button" aria-pressed={o.review==="rejected"} onClick={()=>decide(o.observationId,"rejected")}>Отклонить метку</button>
        {o.review!=="unreviewed"&&<button type="button" onClick={()=>decide(o.observationId,"unreviewed")}>Сбросить отметку</button>}
      </div>
    </li>)}</ul>
    {!review.observations.length&&<p>Ненулевых меток нет. Отсутствие разметки не означает отсутствие патологии.</p>}
    <div className="ora-evidence-actions"><button type="button" onClick={()=>download(review,"evidence")}>Скачать Evidence JSON</button></div>
    <section className="ora-review-history" aria-label="История проверки Evidence">
      <h3>История проверки · версия {review.reviewHistory.events.length}</h3>
      <p>Изменения сохраняются в памяти страницы и локальном JSON. Сброс отметки добавляет новую запись. Автор и время не удостоверены; это не электронная подпись.</p>
      {historyError&&<p role="alert" className="ora-evidence-error">{historyError} Текущие отметки сохранены.</p>}
      {imported&&<p role="status">История восстановлена для текущего источника и маски. Происхождение файла не удостоверено.</p>}
      <details><summary>Показать изменения ({review.reviewHistory.events.length})</summary>
        <ol>{review.reviewHistory.events.map(event=><li key={event.revision}>#{event.revision} · {review.observations.find(o=>o.observationId===event.observationId)?.labelName} · {decisionLabel[event.from]} → {decisionLabel[event.to]} · <time dateTime={event.at}>{new Date(event.at).toLocaleString("ru-RU")}</time></li>)}</ol>
        {!review.reviewHistory.events.length&&<p>Изменений ещё нет.</p>}
      </details>
      <div className="ora-evidence-actions"><button type="button" onClick={()=>download(review.reviewHistory,"review")}>Скачать историю JSON</button></div>
      <label>Восстановить историю JSON <input type="file" accept=".json,application/json" onChange={e=>{void restore(e.target.files?.[0]);e.target.value="";}}/></label>
    </section>
    <details className="ora-evidence-draft"><summary>Привязка к источнику и ограничения</summary>
      <p>SHA-256 исходного объёма: {review.source.inputSha256}<br/>SHA-256 маски: {review.mask.sha256}<br/>SHA-256 весов: {review.producer.model.weightsSha256}</p>
      <ul>{review.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
    <small>Отметки существуют в памяти страницы и включаются в локальный JSON. Маска сохраняется для сравнения даже при отклонении. Электронной подписи и утверждённого заключения нет. Провайдеры Gemini/Claude не вызываются.</small>
    <EvidenceComparisonReview evidence={review} onNavigate={onNavigate} onSampleMask={onSampleMask}/>
  </section>;
}
