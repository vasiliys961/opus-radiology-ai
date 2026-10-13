"use client";

import { useMemo, useRef, useState } from "react";
import type { DicomSeries } from "../lib/dicom-series";
import {sha256} from "../lib/analysis-package";
import {evaluateLocalDiagnosticReview} from "../lib/patient-cloud-policy";
import {buildLocalDiagnosticDraft} from "../lib/local-diagnostic-review";
import { bindFindingsToLocalDicom, parseReviewableOrchestraResult,
  type ReviewableOrchestraResult } from "../lib/ai-review";

/**
 * Local review only: external model responses are NOT a diagnosis.
 * Selecting a source image never changes or writes the DICOM data.
 */
export default function AiEvidenceReview({
  series, onNavigate,
}: { series: readonly DicomSeries[]; onNavigate: (memberId: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ReviewableOrchestraResult | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, "recheck" | "dismiss">>({});
  const [aiSha,setAiSha]=useState("");
  const [clinicalQuestion,setClinicalQuestion]=useState("");
  const [clinicianSynthesis,setClinicianSynthesis]=useState("");
  const [differentials,setDifferentials]=useState<Record<string,string>>({});
  const [draftError,setDraftError]=useState("");
  const binding = useMemo(() => {
    if (!result) return { links: [], warning: "" };
    try { return { links: bindFindingsToLocalDicom(result, series), warning: "" }; }
    catch (err) { return { links: [], warning: err instanceof Error ? err.message : "Привязка DICOM не подтверждена." }; }
  }, [result, series]);
  const localAccess=evaluateLocalDiagnosticReview({
    modality:result?.modality??"CT",
    sourceBound:!!result&&!binding.warning&&!!aiSha,
    sourceChanged:!!binding.warning,
  });
  const exportLocalDraft=()=>{
    if(!result||!localAccess.permitted){setDraftError("Сначала подтвердите актуальные DICOM-срезы.");return;}
    let url:string|null=null;
    try{
      const draft=buildLocalDiagnosticDraft({
        modality:result.modality,sourceBound:localAccess.permitted,
        sourceChanged:!!binding.warning,aiResultSha256:aiSha,
        findings:binding.links,decisions,differentials,clinicalQuestion,clinicianSynthesis,
      });
      url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:"application/json"}));
      const a=document.createElement("a");a.href=url;a.download="opus-local-diagnostic-draft.json";
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url!),1000);url=null;setDraftError("");
    }catch(e){setDraftError(e instanceof Error?e.message:"Не удалось сформировать локальный черновик.");}
    finally{if(url)URL.revokeObjectURL(url);}
  };
  const importJson = async (file: File) => {
    setBusy(true); setError("");
    try {
      if (file.size > 512_000) throw new Error("Файл AI превышает лимит 512 КБ.");
      const bytes=await file.arrayBuffer();
      const parsed = parseReviewableOrchestraResult(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
      bindFindingsToLocalDicom(parsed, series);
      const digest=await sha256(bytes);
      setResult(parsed); setFilename(file.name);setAiSha(digest); setDecisions({});
      setClinicalQuestion("");setClinicianSynthesis("");setDifferentials({});setDraftError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать результат.");
      // A failed replacement does not silently clear a previously verified import.
    } finally { setBusy(false); }
  };
  return <section className="ora-evidence-panel" aria-label="Врачебная проверка AI-находок">
    <header className="ora-evidence-heading">
      <div><h2>AI-находки · проверка по срезам</h2>
        <p>Загрузка подготовленного JSON-результата — только локально</p>
      </div>
      <span className="ora-evidence-experimental">RESEARCH</span>
    </header>
    <p className="ora-evidence-explainer">Здесь можно проверить, что каждая находка относится к загруженной серии и конкретному DICOM-кадру. Модель не ставит диагноз. Совпадение UID не подтверждает личность пациента или достоверность наблюдения.</p>
    <div className="ora-evidence-actions">
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !series.length}>
        {busy ? "Проверка JSON…" : result ? "Заменить результат .json" : "Импортировать результат AI .json"}
      </button>
      {result && <button type="button" onClick={() => {
        setResult(null); setFilename("");setAiSha(""); setDecisions({});setDifferentials({});setClinicianSynthesis("");setClinicalQuestion("");setDraftError(""); setError("");
      }}>Очистить AI-находки</button>}
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (f) void importJson(f);
      }}/>
    </div>
    {!series.length && <p className="ora-evidence-subtle">Сначала загрузите папку DICOM для проверки пространственной привязки.</p>}
    {error && <p role="alert" className="ora-evidence-error">{error}</p>}
    {binding.warning && <p role="alert" className="ora-evidence-error">
      Сопоставление потеряло актуальность: {binding.warning} Не используйте старый результат с другими снимками.
    </p>}
    {result && !binding.warning && <>
      <div className="ora-evidence-success"><strong>Ссылки на DICOM подтверждены</strong>
        <span>{filename} · {result.provider} · {binding.links.length} наблюдений</span></div>
      <p className="ora-evidence-subtle">Охват: {result.evidence.coverage === "partially_assessed" ?
        "часть изображений" : result.evidence.coverage === "not_assessed" ? "не оценён" : "заявлен как оценённый"}.
        Отсутствие AI-находок не означает отсутствие патологии.</p>
      {binding.links.length ? <ul className="ora-evidence-list">
        {binding.links.map(link => {
          const finding = result.evidence.findings.find(f => f.findingId === link.findingId);
          const decision = decisions[link.findingId];
          return <li key={link.findingId}>
            <div className="ora-evidence-entry"><strong>{link.anatomy}</strong>
              <span>{link.needsRecheck ? "Повторная проверка" : "Кандидат"}</span></div>
            <p>{link.sign}</p><small>{link.sourceLabel} · {link.findingId}</small>
            {finding?.limitations.map((w, i) => <small key={i} className="ora-evidence-limit">{w}</small>)}
            <div className="ora-evidence-row">
              <button type="button" onClick={() => onNavigate(link.memberId)}>Открыть исходный срез</button>
              <button type="button" aria-pressed={decision === "recheck"} onClick={() =>
                setDecisions(prev => ({ ...prev, [link.findingId]: "recheck" }))}>На перепроверку</button>
              <button type="button" aria-pressed={decision === "dismiss"} onClick={() =>
                setDecisions(prev => ({ ...prev, [link.findingId]: "dismiss" }))}>Отклонить локально</button>
            </div>
          </li>;
        })}
      </ul> : <p className="ora-evidence-subtle">В результате нет наблюдений. Это не отрицательный результат медицинского исследования.</p>}
      <details className="ora-evidence-draft">
        <summary>Черновик клинического синтеза · требует проверки врача</summary>
        <p>{result.clinicalDraft.summary}</p>
        {result.clinicalDraft.limitations.map((w, i) => <p key={i} className="ora-evidence-limit">{w}</p>)}
      </details>
      <section className="ora-reviewer-note" aria-label="Локальный диагностический разбор">
        <h3>Диагностический разбор · локально</h3>
        <p>Врач может сформулировать предварительный дифференциальный ряд и клинический вопрос по исходным срезам.
          Это работа с находками, а не автоматическая постановка диагноза. Файлы не отправляются в облако.</p>
        <p role="status">{localAccess.reason}</p>
        <label>Клинический вопрос
          <textarea rows={2} maxLength={1000} value={clinicalQuestion}
            onChange={e=>setClinicalQuestion(e.target.value)} disabled={!localAccess.permitted}/>
        </label>
        {binding.links.map(link=><label key={link.findingId}>
          Возможные объяснения / что перепроверить: {link.anatomy} · {link.findingId}
          <textarea rows={2} maxLength={1200} value={differentials[link.findingId]??""}
            onChange={e=>setDifferentials(prev=>({...prev,[link.findingId]:e.target.value}))}
            disabled={!localAccess.permitted}/>
        </label>)}
        <label>Рабочий врачебный синтез (обязательно для черновика)
          <textarea rows={5} maxLength={4000} value={clinicianSynthesis}
            onChange={e=>setClinicianSynthesis(e.target.value)} disabled={!localAccess.permitted}/>
        </label>
        <div className="ora-evidence-actions">
          <button type="button" disabled={!localAccess.permitted||!clinicianSynthesis.trim()}
            onClick={exportLocalDraft}>Скачать локальный диагностический черновик JSON</button>
        </div>
        {draftError&&<p role="alert" className="ora-evidence-error">{draftError}</p>}
        <small>Нет автоматической диагностики, отрицательного заключения, электронной подписи или внешней передачи. Автор текста не удостоверен.</small>
      </section>
      <p className="ora-evidence-subtle">Отметки перепроверки/отклонения и текст черновика живут только в памяти страницы.
        Экспортируйте их локально, если требуется сохранить. Не публикуйте файлы, содержащие сведения о пациентах.</p>
    </>}
  </section>;
}
