"use client";

import { useEffect, useState } from "react";
import { AI_CATALOG, modelsForRole, type ProviderId, type SegmentationId } from "../lib/v17-models";
import { PILOT_CASES, PILOT_NOTES } from "../lib/v17-pilot";
import { deriveStudyReadiness } from "../lib/study-intelligence";
import type { DicomSeries } from "../lib/dicom-series";
import { useAnalysisSound } from "./AnalysisSoundProvider";

const PREF_KEY = "opus-radiology-v17-ui-preferences";
type Preferences = {
  provider: ProviderId;
  vision: string;
  clinical: string;
  anatomy: SegmentationId;
};
const DEFAULTS: Preferences = {
  provider: "polza",
  vision: "google/gemini-3.8-flash",
  clinical: "anthropic/claude-sonnet-5.5",
  anatomy: "totalsegmentator",
};
function restorePrefs(raw: string | null): Preferences {
  if (!raw) return DEFAULTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULTS;
    const value = parsed as Partial<Preferences>;
    const byRole = (role: "vision" | "clinical", requested: unknown, fallback: string) =>
      modelsForRole(role).some(m => m.id === requested) ? String(requested) : fallback;
    return {
      provider: value.provider === "openrouter" || value.provider === "polza" ? value.provider : DEFAULTS.provider,
      vision: byRole("vision", value.vision, DEFAULTS.vision),
      clinical: byRole("clinical", value.clinical, DEFAULTS.clinical),
      anatomy: value.anatomy === "nv-segment-ctmr" || value.anatomy === "totalsegmentator" ? value.anatomy : DEFAULTS.anatomy,
    };
  } catch { return DEFAULTS; }
}
const dice = (v: number) => v.toFixed(3).replace(".", ",");
export default function AiWorkflowPanel({ series }: { series: readonly DicomSeries[] }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [mounted, setMounted] = useState(false);
  const [compare, setCompare] = useState(false);
  const { enabled: chimeEnabled, setSoundEnabled, previewChime } = useAnalysisSound();
  const [soundFeedback, setSoundFeedback] = useState("");
  useEffect(() => {
    setPrefs(restorePrefs(window.localStorage.getItem(PREF_KEY)));
    setMounted(true);
  }, []);
  useEffect(() => {
    if (mounted) window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  }, [prefs, mounted]);
  const readiness = deriveStudyReadiness(series);
  const selected = AI_CATALOG.find(model => model.id === prefs.anatomy);
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPrefs(previous => ({ ...previous, [key]: value }));
  return <div className="ora-v17-panel">
    <div className="ora-v17-heading">
      <strong>AI-оркестр · v1.7</strong>
      <span>Этап подключения</span>
    </div>
    <p className="ora-v17-muted">Выбор моделей работает. Передача снимков в облако и автоматический инференс пока выключены — реальные пациенты не отправляются.</p>
    <div className="ora-v17-grid">
      <label htmlFor="ora-provider-choice">AI-шлюз
        <select id="ora-provider-choice" value={prefs.provider} onChange={e => set("provider", e.target.value as ProviderId)}>
          <option value="polza">Polza AI · РФ</option>
          <option value="openrouter">OpenRouter · вне РФ</option>
        </select>
      </label>
      <label htmlFor="ora-vision-choice">Vision · глаза
        <select id="ora-vision-choice" value={prefs.vision} onChange={e => set("vision", e.target.value)}>
          {modelsForRole("vision").map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label htmlFor="ora-clinical-choice">Клинический синтез
        <select id="ora-clinical-choice" value={prefs.clinical} onChange={e => set("clinical", e.target.value)}>
          {modelsForRole("clinical").map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label htmlFor="ora-anatomy-choice">Анатомическая модель
        <select id="ora-anatomy-choice" value={prefs.anatomy} onChange={e => set("anatomy", e.target.value as SegmentationId)}>
          <option value="totalsegmentator">TotalSegmentator · основной кандидат</option>
          <option value="nv-segment-ctmr">NV-Segment-CTMR · исследовательская</option>
        </select>
      </label>
    </div>
    <div className="ora-v17-guidance">
      <strong>{selected?.label} · не подключена</strong>
      <span>{selected?.notes}</span>
      <small>{selected?.weightsLicence}</small>
    </div>
    <div className="ora-v17-readiness">
      <div className="ora-v17-heading"><strong>Паспорт технической готовности</strong><span>{readiness.modality}</span></div>
      <div className="ora-v17-stats">
        <div><strong>{readiness.seriesCount}</strong><small>Серий DICOM</small></div>
        <div><strong>{readiness.volumeEligible}</strong><small>Геометрия подтверждена</small></div>
        <div><strong>{readiness.unsafeGeometry}</strong><small>Требуют проверки</small></div>
      </div>
      {readiness.warnings.map((warning, i) => <p key={i} className="ora-v17-caution">{warning}</p>)}
    </div>
    <div className="ora-v17-models">
      <strong>Дополнительные кандидаты</strong>
      <div>MedSAM2 / Efficient MedSAM2 — отложенный эксперимент для ROI, без загрузки весов. MedGemma исключена из плана: региональная доступность не гарантирована.</div>
    </div>
    <button className="ora-v17-compare" type="button" aria-expanded={compare} onClick={() => setCompare(v => !v)}>
      {compare ? "Скрыть пилот 6 исследований" : "Показать сравнительный пилот Total / NV"}
    </button>
    {compare && <div className="ora-v17-table-wrap">
      <table className="ora-v17-table">
        <caption>Средний Dice по выбранным анатомическим структурам; 12 запусков, без оценки патологий</caption>
        <thead><tr><th>Исследование</th><th>Структур</th><th>Total</th><th>NV</th></tr></thead>
        <tbody>{PILOT_CASES.map(c => <tr key={c.id}>
          <td>{c.modality === "CT" ? "КТ" : "МРТ"} · {c.region}</td>
          <td>{c.structures}</td><td>{dice(c.totalDice)}</td><td>{dice(c.nvDice)}</td>
        </tr>)}</tbody>
      </table>
      <p className="ora-v17-caution">Режимы различались по разрешению (3 мм / 1,5 мм). Слабая сегментация поджелудочной железы на МРТ: Dice {dice(PILOT_NOTES.weakMRPancreasTotalDice)} / {dice(PILOT_NOTES.weakMRPancreasNvDice)}. Нет внешней клинической валидации; Mac M1 не тестировался.</p>
    </div>}
    <p className="ora-v17-muted">Выбор сохраняется только в этом браузере, а не в профиле врача на сервере. Доступность выбранной модели через шлюз пока не проверена.</p>
    <div className="ora-completion-audio" aria-label="Звук после завершения операций">
      <div className="ora-v17-heading"><strong>Звуковые уведомления</strong><span>Локально · WebAudio</span></div>
      <label className="ora-completion-toggle">
        <input type="checkbox" checked={chimeEnabled} onChange={e => {
          setSoundEnabled(e.target.checked);
          setSoundFeedback(e.target.checked ? "Звук включён. Проверьте динамики кнопкой ниже." : "Звук выключен.");
        }}/>
        «Дзинь» после успешного завершения операции
      </label>
      <button type="button" className="ora-vision-plan-audio-test" onClick={() => {
        void previewChime().then(ok => setSoundFeedback(ok ?
          "Тестовый сигнал воспроизведён. Если не слышно — проверьте громкость Mac." :
          "Браузер не разрешил воспроизвести звук. Проверьте разрешения и повторите нажатие."));
      }}>Проверить звук · дзинь</button>
      {soundFeedback && <p className="ora-v17-muted" role="status">{soundFeedback}</p>}
      <p className="ora-v17-muted">Сейчас звонок работает для локальной подготовки Vision-кадров.
        После подключения настоящего AI-инференса этот же сигнал будет вызываться только при успешном завершении анализа.</p>
    </div>
    <button className="ora-analyze-button" type="button" disabled aria-label="Гибридный AI-анализ ещё не доступен">Запустить гибридный анализ · скоро</button>
  </div>;
}
