"use client";

import { useEffect, useMemo, useState } from "react";
import type { DicomSeries } from "../lib/dicom-series";
import { planVisionFrameSamples, MAX_VISION_SAMPLE_FRAMES,
  type VisionFramePlan } from "../lib/vision-frame-plan";
import { useAnalysisSound } from "./AnalysisSoundProvider";
import { routeDicomConsilium } from "../lib/dicom-consilium-routing";
import {routeUniversalCtMrVision} from "../lib/universal-ct-mr-vision-route";
import { dispatchDicomDetectors, type DetectorDispatch } from "../lib/dicom-detector-dispatch";
import { localLaa950Executor } from "../lib/local-laa950-evidence-executor";
import { planBudgetedVisionReview } from "../lib/vision-budget-plan";
import { createVisionBatches, accountReportedVisionUsage } from "../lib/vision-batch-ledger";
import { decodeDicomPreview } from "../lib/dicom-lite";
import { MAX_PRIVACY_PIXELS } from "../lib/vision-privacy";
import VisionPrivacyPreparation from "./VisionPrivacyPreparation";
import {sameSeriesR231Facts,type CapturedLocalSpecialist} from "../lib/same-series-r231-cloud-evidence";
import {sameSeriesLaa950ForReview,type CapturedLocalLaa950} from "../lib/same-series-laa950-review";

export default function VisionFramePlanningPanel({
  series, activeSeriesKey, fileById, onOpenSlice,capturedSpecialist,capturedLaa950,
}: {
  series: readonly DicomSeries[];
  activeSeriesKey: string | null;
  fileById: ReadonlyMap<string, File>;
  onOpenSlice: (fileId: string) => void;
  capturedSpecialist?:CapturedLocalSpecialist|null;
  capturedLaa950?:CapturedLocalLaa950|null;
}) {
  const [requested, setRequested] = useState(4);
  const [targetFrame, setTargetFrame] = useState("");
  const [report, setReport] = useState<VisionFramePlan | null>(null);
  const [notice, setNotice] = useState("");
  const [detectorResult, setDetectorResult] = useState<DetectorDispatch | null>(null);
  const [detectorBusy, setDetectorBusy] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, { url?: string; error?: string }>>({});
  const { completionChime } = useAnalysisSound();
  let specialistFacts=null, specialistWarning="";
  if(capturedSpecialist){
    try{
      const selected=series.find(s=>s.key===activeSeriesKey);
      specialistFacts=sameSeriesR231Facts(selected,capturedSpecialist);
    }catch{specialistWarning="Результат CPU R231 не совпадает с текущей DICOM-серией. Численные данные не будут переданы."}
  }
  let localLaa950=null, laaWarning="";
  if(capturedLaa950){
    try{localLaa950=sameSeriesLaa950ForReview(
      series.find(x=>x.key===activeSeriesKey),capturedSpecialist,capturedLaa950);
    }catch{laaWarning="Показатель LAA−950 не совпадает с текущей КТ и маской R231; не использовать.";}
  }
  const choice = useMemo(() => {
    // Never silently choose some other series when a specific series is selected.
    return planVisionFrameSamples(series, activeSeriesKey, requested);
  }, [series, activeSeriesKey, requested]);
  const consilium = useMemo(() => routeDicomConsilium(series.find(s => s.key === activeSeriesKey) ?? null), [series, activeSeriesKey]);
  const universal = useMemo(() => routeUniversalCtMrVision(series.find(s => s.key === activeSeriesKey) ?? null), [series, activeSeriesKey]);
  const fullVolumeCost = useMemo(() => {
    if (choice.status !== "ready-for-local-preview" || !choice.seriesKey) return null;
    const selected = series.find(s => s.key === choice.seriesKey);
    if (!selected || !selected.members.length) return null;
    const index = targetFrame.trim() === "" ? null : Number(targetFrame) - 1;
    if (index !== null && (!Number.isSafeInteger(index) || index < 0 || index >= selected.members.length)) return null;
    try {
      return planBudgetedVisionReview({frameCount: selected.members.length,
        flaggedIndices: index === null ? [] : [index]});
    } catch { return null; }
  }, [choice, series, targetFrame]);
  const batchPreview = useMemo(() => {
    if (!fullVolumeCost) return null;
    const batches = createVisionBatches(fullVolumeCost);
    return { batches, ledger: accountReportedVisionUsage(fullVolumeCost, batches, []) };
  }, [fullVolumeCost]);
  useEffect(() => {
    setReport(null);
    setDetectorResult(null);
    setNotice("");
    setThumbnails({});
  }, [series, activeSeriesKey, requested]);
  useEffect(() => {
    if (!report) return;
    let cancelled = false;
    setThumbnails({});
    const render = async () => {
      // Serial bounded decoding: never hold four full DICOM pixel arrays on M1.
      for (const frame of report.frames) {
        if (cancelled) return;
        const file = fileById.get(frame.fileId);
        let preview: { url?: string; error?: string };
        if (!file) preview = { error: "Исходный файл отсутствует." };
        else if (file.size > 6 * 1024 * 1024)
          preview = { error: "Локальная миниатюра ограничена размером 6 МиБ; откройте срез в Cornerstone." };
        else {
          try {
            const result = await decodeDicomPreview(file,{maxPixels:MAX_PRIVACY_PIXELS});
            preview = { url: result.url };
          } catch {
            preview = { error: "Локальный декодер не поддерживает этот DICOM. Просмотр возможен в Cornerstone." };
          }
        }
        if (cancelled) return;
        setThumbnails(previous => ({ ...previous, [frame.fileId]: preview }));
      }
    };
    void render();
    return () => { cancelled = true; };
  }, [report, fileById]);
  const prepare = () => {
    if (choice.status === "blocked") {
      setNotice("Локальный план не составлен: " + choice.blockers.join(" "));
      setReport(null);
      return;
    }
    setReport(choice);
    setNotice("Локальная подготовка завершена. Изображения НЕ анализировались AI и не отправлялись в облако.");
    void completionChime(); // sound only after successful preparation and explicit opt-in
  };
  return <section className="ora-vision-plan" aria-label="Локальная подготовка кадров для Gemini">
    <div className="ora-vision-plan-head">
      <div><h2>Gemini Orchestra · подготовка кадров</h2>
        <p>v1.8 · локальный предварительный этап</p></div>
      <span>ЛОКАЛЬНАЯ ПОДГОТОВКА</span>
    </div>
    <p className="ora-vision-plan-lead">
      Сформируем технический список отдельных DICOM-срезов для Vision-анализа.
      На этом этапе DICOM остаётся в браузере. Отправка обезличенных копий через OpenRouter
      возможна только после локальных проверок и отдельного разрешения исследовательского сервера.
    </p>
    <div className="ora-vision-plan-controls">
      <label htmlFor="ora-frame-count">Кадров в выборке
        <select id="ora-frame-count" value={requested}
          onChange={e => setRequested(Number(e.target.value))}>
          {Array.from({length: MAX_VISION_SAMPLE_FRAMES - 1}, (_, i) => i + 2).map(n =>
            <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button type="button" onClick={prepare} disabled={choice.status !== "ready-for-local-preview"}>
        Сформировать план
      </button>
    </div>
    <div className="ora-vision-budget-preview" role="status" aria-label="Универсальный анализ КТ и МРТ">
      <strong>Gemini + Opus · универсальный анализ {universal.modality==="CT"?"КТ":universal.modality==="MR"?"МРТ":"DICOM"}</strong>
      <p>{universal.reason}</p>
      <p>Универсальный маршрут не зависит от установленных детекторов. Подготовка кадров и отдельное разрешение облачной передачи выполняются ниже; готовность маршрута не означает, что изображения уже проанализированы.</p>
    </div>
    <div className="ora-vision-budget-preview" aria-label="Локальный маршрут диагностического консилиума">
      <strong>Диагностический консилиум · автоматический маршрут</strong>
      {consilium.status === "ready" ? <>
        <p>Выбранные специалисты Gemini: {consilium.specialists.join(", ")}.</p>
        <p>Диагностические направления-кандидаты: {consilium.detectorTargets.join(", ")}.</p>
        <p>Claude Opus сопоставляет независимые результаты детекторов и визуальных специалистов после их фактического выполнения.</p>
        <p>Статус: локальный маршрут сформирован; ниже доступна проверка наличия исполнителей без передачи изображений.</p>
        <button type="button" disabled={detectorBusy} onClick={() => {
          const selected = series.find(s => s.key === activeSeriesKey) ?? null;
          setDetectorBusy(true);
          // Registered local quantitative research executor, not a pathology model.
          void dispatchDicomDetectors(selected, [localLaa950Executor(capturedSpecialist,capturedLaa950)]).then(setDetectorResult)
            .catch(() => setNotice("Проверка исполнителей не завершилась."))
            .finally(() => setDetectorBusy(false));
        }}>{detectorBusy ? "Проверяем…" : "Проверить доступные локальные детекторы"}</button>
        {detectorResult && <div role="status">
          <p>Реально выполнено диагностических моделей: {detectorResult.executed.length}. Получено Evidence: {detectorResult.evidence.length}.</p>
          <p>Не подключено или заблокировано направлений: {detectorResult.blocked.length}.</p>
          {detectorResult.blocked.map(item => <p key={item.target}>{item.target}: {item.reason === "No registered executable model" ? "исполнитель с проверенными весами пока не подключён" : item.reason}</p>)}
          {detectorResult.evidence.flatMap(e => e.warnings).map((warning,i)=><p key={i}>{warning}</p>)}
          <p>R231/LAA−950 — количественный исследовательский показатель, не диагностический детектор эмфиземы. Отсутствие результатов не исключает патологию. Изображения никуда не передавались.</p>
        </div>}
      </> : <p role="status">{consilium.reason}</p>}
    </div>
    <div className="ora-vision-budget-preview" aria-label="Бюджет полного обзора Gemini">
      <strong>Двухэтапный обзор всей серии — локальный расчёт</strong>
      <p>Отдельно от выборки 2–4 кадров рассчитываем просмотр каждого среза в низком
        разрешении и выборочный повторный просмотр соседних кадров в высоком разрешении.</p>
      <label htmlFor="ora-target-frame">Подозрительный срез (номер от 1, необязательно)
        <input id="ora-target-frame" type="number" min="1" step="1"
          value={targetFrame} onChange={e => setTargetFrame(e.target.value)}
          placeholder="Пока не отмечен" />
      </label>
      {fullVolumeCost ? <>
        <p>План: {fullVolumeCost.overviewIndices.length} кадров обзорно,
          {fullVolumeCost.targetedIndices.length} кадров прицельно.</p>
        {batchPreview && <p>Пакетов по 12 срезов: {batchPreview.batches.length}. Фактически обработано: {batchPreview.ledger.processedOverviewFrames} из {batchPreview.ledger.plannedFrames}. Подтверждённый расход API: {batchPreview.ledger.totalUSD.toFixed(3)} USD (вызовов пока не было).</p>}
        <p>Предварительная стоимость Gemini: <strong>
          ${fullVolumeCost.estimatedGeminiUSD.toFixed(3)}</strong> за исследование
          (тариф и число токенов — настраиваемые предположения, не счёт провайдера).</p>
        {fullVolumeCost.requiresExplicitBudgetApproval ?
          <p role="status">Выше предварительного порога ${fullVolumeCost.maxGeminiUSD.toFixed(2)}.
            Для будущего реального запроса потребуется отдельное разрешение расходов.</p> :
          <p>Ниже ориентировочного порога ${fullVolumeCost.maxGeminiUSD.toFixed(2)}.</p>}
        <p>Обзор всех срезов пока <strong>только запланирован</strong>.
          Изображения не декодировались для полного обзора, AI не запускался,
          облачная передача заблокирована. Отсутствие отметок не исключает патологию.</p>
      </> : <p role="status">План полного обзора недоступен: проверьте DICOM-геометрию
        и номер подозрительного среза.</p>}
    </div>
    {choice.status === "blocked" && <div className="ora-vision-plan-blocked" role="status">
      <strong>План пока недоступен</strong>
      {choice.blockers.map((reason, i) => <p key={i}>{reason}</p>)}
    </div>}
    {notice && <p className="ora-vision-plan-notice" role="status">{notice}</p>}
    {report && <div className="ora-vision-plan-result">
      <strong>Готов список из {report.frames.length} кадров</strong>
      <div className="ora-vision-plan-list">
        {report.frames.map((frame, index) => <div key={frame.sopInstanceUid + "/" + frame.frameIndex}>
          <div><b>Кадр {index + 1}</b>
            <span>Срез {frame.ordinal} из {frame.totalFrames}</span></div>
          <small>Позиция по нормали: {frame.slicePositionMm === null ? "неизвестна" :
            frame.slicePositionMm.toFixed(2) + " мм"}</small>
          {thumbnails[frame.fileId]?.url ?
            <img className="ora-vision-plan-thumbnail" src={thumbnails[frame.fileId].url}
              alt={"Локальный предпросмотр DICOM, кадр " + (index + 1)} /> :
            <div className="ora-vision-plan-thumb-placeholder">
              {thumbnails[frame.fileId]?.error ?? "Готовим миниатюру локально…"}
            </div>}
          <button type="button" onClick={() => onOpenSlice(frame.fileId)}>Открыть исходный срез</button>
        </div>)}
      </div>
      <p>Охват: только отдельные кадры. Количественные измерения, диагнозы и
        отсутствие патологий этим планом не устанавливаются.</p>
      <p>Загрузка изображений в AI: <strong>заблокирована по умолчанию</strong>.
        Исходные DICOM в облако не отправляются. Платная передача отдельных
        проверенных PNG возможна только после обезличивания, OCR, подтверждения
        врача и допуска локального OpenRouter-пилота.</p>
      {specialistFacts&&<p role="status">Локальный R231: правая маска {specialistFacts.rightLungMaskMl.toFixed(1)} мл,
        левая {specialistFacts.leftLungMaskMl.toFixed(1)} мл. Это сегментация анатомии,
        не детекция заболевания. Числа можно передать в дополнительный анализ
        вместе с кадрами только по явному разрешению.</p>}
      {specialistWarning&&<p role="status">{specialistWarning}</p>}
      {localLaa950&&<p role="status">Локальный LAA−950 для этой КТ:
        {localLaa950.lowAttenuationPctOfSampledMask.toFixed(2)}% обработанной маски
        (справа {localLaa950.rightLungPct.toFixed(2)}%,
        слева {localLaa950.leftLungPct.toFixed(2)}%).
        Только локальный исследовательский контекст: эти цифры не отправляются в OpenRouter
        и не подтверждают диагноз эмфиземы.</p>}
      {laaWarning&&<p role="status">{laaWarning}</p>}
      <VisionPrivacyPreparation key={JSON.stringify(report.frames.map(f=>f.fileId))+requested}
        previews={report.frames.map(f=>thumbnails[f.fileId]?.url)}
        modality={series.find(s=>s.key===report.seriesKey)?.modality??""}
        specialistFacts={specialistFacts}
        localLaa950={localLaa950}
        specialistLocalBinding={specialistFacts&&capturedSpecialist?
          capturedSpecialist.evidence.source.inputSha256+":"+capturedSpecialist.evidence.mask.sha256:""}
        originalLocalFileIds={report.frames.map(f=>f.fileId)}
        onOpenOriginalSlice={onOpenSlice}/>
    </div>}
    <p className="ora-vision-plan-footnote">Отбираем по равномерным индексам геометрически проверенной серии,
      сохраняя исходные SOPInstanceUID локально. Выборка не гарантирует обнаружения очагов между срезами.</p>
  </section>;
}
