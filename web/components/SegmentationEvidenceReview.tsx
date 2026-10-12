"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { type EvidenceDecision, type SegmentationEvidence } from "../lib/segmentation-evidence";
import { changeEvidenceReview, MAX_REVIEW_JSON_BYTES, restoreEvidenceReview, startEvidenceReview } from "../lib/evidence-review-history";
import type { Point3 } from "../lib/segmentation-mask";
import EvidenceComparisonReview from "./EvidenceComparisonReview";
import EvidenceReportDownload from "./EvidenceReportDownload";
import { latestReviewerNote,MAX_NOTE_CHARS,MAX_NOTE_JSON_BYTES,restoreReviewerNote,reviewerNoteNeedsRecheck,saveReviewerNote,type EvidenceWithNote } from "../lib/evidence-reviewer-note";
const decisionLabel: Record<EvidenceDecision,string>={unreviewed:"Не проверено врачом",requires_recheck:"На перепроверку",rejected:"Отклонено локально"};

/** Mount with a binding key so replacement/series changes discard old reviews. */
export default function SegmentationEvidenceReview({evidence,onNavigate,onSampleMask}: {
  evidence: SegmentationEvidence; onNavigate: (point: Point3,labelId: number | null)=>void;
  onSampleMask: (point: Point3)=>number | null;
}) {
  const [review,setReview]=useState<EvidenceWithNote>(()=>startEvidenceReview(evidence));
  const [noteTarget,setNoteTarget]=useState<string|null>(null);
  const [noteDraft,setNoteDraft]=useState("");
  const [noteError,setNoteError]=useState("");
  const latestNote=latestReviewerNote(review.reviewerNote,noteTarget);
  const targetObservation=review.observations.find(o=>o.observationId===noteTarget);
  const noteDirty=noteDraft!==(latestNote?.text??"");
  const noteStale=useMemo(()=>reviewerNoteNeedsRecheck(review,noteTarget),[review,noteTarget]);
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
  const saveNote=()=>{
    ++importVersion.current;
    try{setReview(saveReviewerNote(review,noteDraft,new Date().toISOString(),noteTarget));setNoteError("");}
    catch(e){setNoteError(e instanceof Error?e.message:"Не удалось сохранить заметку.");}
  };
  const restoreNote=async(file?:File)=>{
    const version=++importVersion.current;if(!file)return;
    try{
      if(noteDirty)throw new Error("Сначала сохраните заметку или сбросьте несохранённые правки.");
      if(file.size>MAX_NOTE_JSON_BYTES)throw new Error("Файл заметки превышает 512 КБ.");
      const raw=await file.text();if(version!==importVersion.current)return;
      const next=restoreReviewerNote(review,raw);setReview(next);
      setNoteDraft(latestReviewerNote(next.reviewerNote,noteTarget)?.text??"");setNoteError("");
    }catch(e){if(version===importVersion.current)setNoteError(e instanceof Error?e.message:"Не удалось восстановить заметку.");}
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
    <section className="ora-reviewer-note" aria-label="Заметка проверяющего">
      <h3>Заметка проверяющего · неподписанный черновик</h3>
      <p>Ваш текст отделён от моделей и включается в отчёт после сохранения. Автор не удостоверен. Текст может содержать чувствительные данные: храните его локально.</p>
      <label>К чему относится заметка <select value={noteTarget??""} disabled={noteDirty} onChange={e=>{
        const target=e.target.value||null;++importVersion.current;setNoteTarget(target);
        setNoteDraft(latestReviewerNote(review.reviewerNote,target)?.text??"");setNoteError("");
      }}><option value="">Общая заметка к результату</option>{review.observations.map(o=><option key={o.observationId} value={o.observationId}>{o.labelId} · {o.labelName}</option>)}</select></label>
      {targetObservation&&<p>Заметка относится к метке маски в загруженных срезах, а не к отдельному очагу патологии.</p>}
      <label>Текст заметки<textarea maxLength={MAX_NOTE_CHARS} autoComplete="off" value={noteDraft} onChange={e=>{++importVersion.current;setNoteDraft(e.target.value);setNoteError("");}} rows={5}/></label>
      <p>{noteDraft.length} / {MAX_NOTE_CHARS} символов · сохранённых версий: {review.reviewerNote?.versions.length??0}</p>
      {noteDirty&&<p role="status">Есть несохранённые правки. Сохраните или сбросьте их перед экспортом отчёта/Evidence.</p>}
      {noteStale&&<p role="status">После сохранения заметки изменились отметки. Заметку нужно перепроверить и сохранить новую версию.</p>}
      {noteError&&<p role="alert" className="ora-evidence-error">{noteError} Текущие сохранённые версии не изменены.</p>}
      <div className="ora-evidence-actions">
        <button type="button" disabled={!noteDirty&&!noteStale} onClick={saveNote}>Сохранить заметку</button>
        <button type="button" disabled={!noteDirty} onClick={()=>{++importVersion.current;setNoteDraft(latestNote?.text??"");setNoteError("");}}>Сбросить правки заметки</button>
        <button type="button" disabled={!review.reviewerNote||noteDirty} onClick={()=>download(review.reviewerNote,"reviewer-note")}>Скачать заметку JSON</button>
        {targetObservation&&<button type="button" onClick={()=>{try{onNavigate(targetObservation.anchorLpsMm,targetObservation.labelId);setNoteError("");}catch{setNoteError("Не удалось перейти к метке: проверьте активную серию MPR.");}}}>Показать метку заметки в MPR</button>}
      </div>
      <details><summary>Версии заметки</summary><ol>{review.reviewerNote?.versions.map(v=><li key={v.revision}>Версия {v.revision} · {v.observationId?review.observations.find(o=>o.observationId===v.observationId)?.labelName:"Общая заметка"} · история проверки {v.reviewRevision} · <time dateTime={v.at}>{new Date(v.at).toLocaleString("ru-RU")}</time><p>{v.text||"Пустая заметка (текст очищен)."}</p></li>)}</ol></details>
      <label>Восстановить заметку JSON <input type="file" accept=".json,application/json" onChange={e=>{void restoreNote(e.target.files?.[0]);e.target.value="";}}/></label>
    </section>
    <div className="ora-evidence-actions"><button type="button" disabled={noteDirty} onClick={()=>download(review,"evidence")}>Скачать Evidence JSON</button></div>
    <EvidenceReportDownload evidence={review} hasUnsavedReviewerNote={noteDirty}/>
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
    <EvidenceComparisonReview evidence={review} onNavigate={onNavigate} onSampleMask={onSampleMask} hasUnsavedReviewerNote={noteDirty}/>
  </section>;
}
