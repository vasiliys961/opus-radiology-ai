"use client";
import { useState } from "react";
import { reviewSegmentationEvidence, type EvidenceDecision, type SegmentationEvidence } from "../lib/segmentation-evidence";
import type { Point3 } from "../lib/segmentation-mask";

/** Mount with a binding key so replacement/series changes discard old reviews. */
export default function SegmentationEvidenceReview({evidence,onNavigate}: {
  evidence: SegmentationEvidence; onNavigate: (point: Point3,labelId: number)=>void;
}) {
  const [review,setReview]=useState(evidence);
  const [error,setError]=useState("");
  const decide=(id:string,decision:EvidenceDecision)=>setReview(previous=>reviewSegmentationEvidence(previous,id,decision));
  const download=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(review,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`opus-${review.source.requestId}.evidence.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="ora-evidence-panel ora-segmentation-evidence" aria-label="Evidence сегментации">
    <header className="ora-evidence-heading"><div><h2>Evidence · результат сегментации</h2>
      <p>{review.producer.model.id} · {review.producer.model.version} · {review.source.frameCount} загруженных срезов</p></div>
      <span className="ora-evidence-experimental">RESEARCH</span></header>
    <p className="ora-evidence-explainer">Объём метки рассчитан по маске и её геометрии только в загруженных срезах. Полнота органа не подтверждена. Это не поиск патологий и не диагноз.</p>
    {error&&<p role="alert" className="ora-evidence-error">{error}</p>}
    <ul className="ora-evidence-list">{review.observations.map(o=><li key={o.observationId}>
      <div className="ora-evidence-entry"><strong>{o.labelName}</strong><span>{o.review==="requires_recheck"?"На перепроверку":o.review==="rejected"?"Отклонено локально":"Не проверено врачом"}</span></div>
      <p>{o.volumeMl.toFixed(3)} мл разметки · {o.voxels.toLocaleString("ru-RU")} вокселей</p>
      <div className="ora-evidence-row">
        <button type="button" onClick={()=>{try{onNavigate(o.anchorLpsMm,o.labelId);setError("");}catch{setError("Не удалось перейти к метке: проверьте активную серию MPR.");}}}>Показать метку в MPR</button>
        <button type="button" aria-pressed={o.review==="requires_recheck"} onClick={()=>decide(o.observationId,"requires_recheck")}>Перепроверить метку</button>
        <button type="button" aria-pressed={o.review==="rejected"} onClick={()=>decide(o.observationId,"rejected")}>Отклонить метку</button>
        {o.review!=="unreviewed"&&<button type="button" onClick={()=>decide(o.observationId,"unreviewed")}>Сбросить отметку</button>}
      </div>
    </li>)}</ul>
    {!review.observations.length&&<p>Ненулевых меток нет. Отсутствие разметки не означает отсутствие патологии.</p>}
    <div className="ora-evidence-actions"><button type="button" onClick={download}>Скачать Evidence JSON</button></div>
    <details className="ora-evidence-draft"><summary>Привязка к источнику и ограничения</summary>
      <p>SHA-256 исходного объёма: {review.source.inputSha256}<br/>SHA-256 маски: {review.mask.sha256}<br/>SHA-256 весов: {review.producer.model.weightsSha256}</p>
      <ul>{review.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
    <small>Отметки существуют в памяти страницы и включаются в локальный JSON. Маска сохраняется для сравнения даже при отклонении. Электронной подписи и утверждённого заключения нет. Провайдеры Gemini/Claude не вызываются.</small>
  </section>;
}
