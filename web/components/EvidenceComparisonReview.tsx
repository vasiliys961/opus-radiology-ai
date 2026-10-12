"use client";
import { useRef, useState } from "react";
import { COMPARISON_REASONS, MAX_LLM_MEASUREMENTS_BYTES, createLlmMeasurementTemplate, parseLlmMeasurements, reconcileEvidence, type LlmMeasurements } from "../lib/evidence-reconciliation";
import type { SegmentationEvidence } from "../lib/segmentation-evidence";

export default function EvidenceComparisonReview({evidence}: {evidence: SegmentationEvidence}) {
  const [llm, setLlm] = useState<LlmMeasurements | null>(null);
  const [error, setError] = useState("");
  const importVersion = useRef(0);
  const comparison = llm ? reconcileEvidence(evidence, llm) : null;
  const importFile = async (file?: File) => {
    const version = ++importVersion.current;
    if (!file) return;
    try {
      if (file.size > MAX_LLM_MEASUREMENTS_BYTES) throw new Error("JSON гипотез слишком большой (максимум 512 КБ).");
      const next = parseLlmMeasurements(await file.text());
      if (version !== importVersion.current) return;
      setLlm(next); setError("");
    } catch (e) {
      if (version === importVersion.current) setError(e instanceof Error ? e.message : "Не удалось прочитать гипотезы LLM.");
    }
  };
  const download = (value: unknown, suffix: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: "application/json"}));
    const a = document.createElement("a"); a.href = url; a.download = `opus-${evidence.source.requestId}.${suffix}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="ora-evidence-comparison" aria-label="Сопоставление с гипотезами LLM">
    <h3>Сопоставление с гипотезами LLM</h3>
    <p>Локальный импорт opus-llm-measurements/v1. Сравнивается только объём указанной метки в тех же загруженных срезах. Файл не подтверждает запуск LLM, её независимость или заявленный охват.</p>
    <div className="ora-evidence-actions"><button type="button" disabled={!evidence.observations.length} onClick={() => download(createLlmMeasurementTemplate(evidence), "llm-template")}>Скачать шаблон гипотез</button></div>
    <small>Шаблон содержит привязку, пустые значения и неизвестный охват. Он не запускает LLM. Храните локально: защита для отправки пациентских данных внешним провайдерам не подтверждена.</small>
    <label>JSON гипотез LLM <input type="file" accept=".json,application/json" onChange={e => {void importFile(e.target.files?.[0]); e.target.value = "";}}/></label>
    {error && <p role="alert" className="ora-evidence-error">{error} Предыдущий импорт, если он был, сохранён.</p>}
    {comparison && <>
      <p>{llm!.producer.provider} · {llm!.producer.model} · происхождение не удостоверено</p>
      <ul className="ora-comparison-list">{comparison.comparisons.map((c, i) => <li key={c.claimId}>
        <strong>{c.status === "not_comparable" ? "Нельзя сопоставить" : c.status === "numeric_match" ? "Числа совпадают" : "Числовое расхождение"} · нужна врачебная проверка</strong>
        <p>{llm!.claims[i].statement}</p>
        <p>Метка: {evidence.observations.find(o => o.observationId === c.observationId)?.labelName ?? "отсутствует"}. Объём маски: {c.specialistVolumeMl === null ? "нет" : `${c.specialistVolumeMl.toPrecision(6)} мл`}; LLM: {c.llmVolumeMl === null ? "нет" : `${c.llmVolumeMl.toPrecision(6)} мл`}.
          {c.deltaMl !== null && ` Разность LLM − маска: ${c.deltaMl.toPrecision(6)} мл.`}</p>
        {c.reasons.length > 0 && <ul>{c.reasons.map(reason => <li key={reason}>{COMPARISON_REASONS[reason]}</li>)}</ul>}
      </li>)}</ul>
      <div className="ora-evidence-actions">
        <button type="button" onClick={() => download(comparison, "comparison")}>Скачать сопоставление JSON</button>
        <button type="button" onClick={() => {++importVersion.current; setLlm(null); setError("");}}>Удалить гипотезы LLM</button>
      </div>
      <small>Совпадение чисел не доказывает клиническое согласие. Порог клинической значимости не задан. Оба результата остаются видны; сравнение не подписывает заключение.</small>
    </>}
  </section>;
}
