"use client";

import { useMemo, useRef, useState } from "react";
import type { DicomSeries } from "../lib/dicom-series";
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
  const binding = useMemo(() => {
    if (!result) return { links: [], warning: "" };
    try { return { links: bindFindingsToLocalDicom(result, series), warning: "" }; }
    catch (err) { return { links: [], warning: err instanceof Error ? err.message : "Привязка DICOM не подтверждена." }; }
  }, [result, series]);
  const importJson = async (file: File) => {
    setBusy(true); setError("");
    try {
      if (file.size > 512_000) throw new Error("Файл AI превышает лимит 512 КБ.");
      const parsed = parseReviewableOrchestraResult(await file.text());
      bindFindingsToLocalDicom(parsed, series);
      setResult(parsed); setFilename(file.name); setDecisions({});
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
        setResult(null); setFilename(""); setDecisions({}); setError("");
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
      <p className="ora-evidence-subtle">Заметки о перепроверке/отклонении существуют только в памяти страницы; медицинского подтверждения, электронной подписи и сохранённого заключения нет.</p>
    </>}
  </section>;
}
