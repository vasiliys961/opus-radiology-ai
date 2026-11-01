"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DicomSeries } from "../lib/dicom-series";
import { planVisionFrameSamples, MAX_VISION_SAMPLE_FRAMES,
  type VisionFramePlan } from "../lib/vision-frame-plan";
import { useAnalysisSound } from "./AnalysisSoundProvider";
import { routeDicomConsilium } from "../lib/dicom-consilium-routing";
import {routeUniversalCtMrVision} from "../lib/universal-ct-mr-vision-route";
import { dispatchDicomDetectors, type DetectorDispatch } from "../lib/dicom-detector-dispatch";
import {createLocalDetectorReview} from "../lib/local-detector-physician-review";
import {installedDetectorRegistry,type InstalledIchRuntime,type InstalledIanpanRuntime} from "../lib/installed-detector-registry";
import {checkPublicIchWorker,runPublicIchWorker,IANPAN_MODEL_ID,IANPAN_MODEL_REVISION} from "../lib/public-ich-worker";
import { planBudgetedVisionReview } from "../lib/vision-budget-plan";
import { createVisionBatches, accountReportedVisionUsage } from "../lib/vision-batch-ledger";
import { decodeDicomPreview } from "../lib/dicom-lite";
import { MAX_PRIVACY_PIXELS } from "../lib/vision-privacy";
import VisionPrivacyPreparation from "./VisionPrivacyPreparation";
import FullVolumeLocalPreparation from "./FullVolumeLocalPreparation";
import type {SanitizedDetectorBundle} from "../lib/detector-consilium-evidence";
import type {ClnVerifiedLocalEvidence} from "../lib/cln-physician-local-review";
import {createClnFrameRelativeEvidence,type ClnFrameRelativeEvidence} from "../lib/cln-frame-relative-evidence";
import {sameSeriesR231Facts,type CapturedLocalSpecialist} from "../lib/same-series-r231-cloud-evidence";
import {sameSeriesLaa950ForReview,type CapturedLocalLaa950} from "../lib/same-series-laa950-review";

export default function VisionFramePlanningPanel({
  series, activeSeriesKey, fileById, onOpenSlice,capturedSpecialist,capturedLaa950,ichRuntime,publicResearchAuthorized=false,originalDetectorEvidence=null,clnVerifiedLocal=null,fromPrimaryAnalysis=false,primaryActionAvailable=false,primaryAnalysisStage="idle",
}: {
  series: readonly DicomSeries[];
  activeSeriesKey: string | null;
  fileById: ReadonlyMap<string, File>;
  onOpenSlice: (fileId: string) => void;
  capturedSpecialist?:CapturedLocalSpecialist|null;
  capturedLaa950?:CapturedLocalLaa950|null;
  /** Present only when a verified local ICH worker is really connected. */
  ichRuntime?:InstalledIchRuntime|null;
  publicResearchAuthorized?:boolean;
  originalDetectorEvidence?:SanitizedDetectorBundle|null;
  clnVerifiedLocal?:ClnVerifiedLocalEvidence|null;
  fromPrimaryAnalysis?:boolean;
  primaryActionAvailable?:boolean;
  primaryAnalysisStage?:"idle"|"running"|"completed"|"vision-only"|"cancelled";
}) {
  const [requested, setRequested] = useState(4);
  const [extraOpened,setExtraOpened]=useState(false);
  // Editing the sampled frame count must invalidate privacy approval until the
  // physician explicitly generates the new source-bound plan.
  const previousRequested=useRef(requested);
  const [targetFrame, setTargetFrame] = useState("");
  const [report, setReport] = useState<VisionFramePlan | null>(null);
  const [notice, setNotice] = useState("");
  const [detectorResult, setDetectorResult] = useState<DetectorDispatch | null>(null);
  const [detectorBusy, setDetectorBusy] = useState(false);
  const detectorController=useRef<AbortController|null>(null);
  const [unifiedStarted,setUnifiedStarted] = useState(false);
  const [ichEndpoint,setIchEndpoint]=useState("http://127.0.0.1:8766");
  const [ichToken,setIchToken]=useState("");
  const [ichResearchConfirmed,setIchResearchConfirmed]=useState(false);
  const [ichWorkerReady,setIchWorkerReady]=useState(false);
  const [ichWorkerNotice,setIchWorkerNotice]=useState("");
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
  const session={endpoint:ichEndpoint,token:ichToken};
  const liveIanpanRuntime:InstalledIanpanRuntime|null=ichWorkerReady&&ichResearchConfirmed ? {
    ready:true,modelId:IANPAN_MODEL_ID,modelRevision:IANPAN_MODEL_REVISION,
    dataPolicy:"public-reference-only",
    run:(s,signal)=>runPublicIchWorker(session,s,fileById,
      signal??new AbortController().signal,setIchWorkerNotice),
  }:null;
  const registered=installedDetectorRegistry({
    capturedSpecialist,capturedLaa950,ichRuntime,publicResearchAuthorized:publicResearchAuthorized||ichResearchConfirmed,
    ianpanRuntime:liveIanpanRuntime,
  });
  const sourceBoundCln=useMemo(()=>{
    const selected=series.find(s=>s.key===activeSeriesKey);
    if(!selected||selected.modality!=="CT"||!clnVerifiedLocal||
       clnVerifiedLocal.dimensions[2]!==selected.members.length||
       !/^[a-f0-9]{64}$/.test(clnVerifiedLocal.sourceNiftiSha256)||
       clnVerifiedLocal.candidates.length>20||
       clnVerifiedLocal.candidates.some(c=>!Number.isSafeInteger(c.sliceIndex)||
         c.sliceIndex<0||c.sliceIndex>=selected.members.length||
         selected.members[c.sliceIndex].metadata.sopInstanceUid!==c.sopInstanceUid))
      return null;
    return clnVerifiedLocal;
  },[series,activeSeriesKey,clnVerifiedLocal]);
  const choice = useMemo(() => {
    // Include up to two distinct source-verified lesion centers in the same
    // four-frame budget. Gemini receives original source pixels independently,
    // never the CLN model's labels or provisional diagnosis.
    return planVisionFrameSamples(series, activeSeriesKey, requested,
      sourceBoundCln?.candidates.map(c=>c.sliceIndex)??null);
  }, [series, activeSeriesKey, requested,sourceBoundCln]);
  let clnSpatial:ClnFrameRelativeEvidence|null=null;
  if(sourceBoundCln?.candidates.length&&report?.status==="ready-for-local-preview"&&
     report.seriesKey===activeSeriesKey&&report.frames.length<=4){
    try{
      const selected=series.find(s=>s.key===activeSeriesKey)!;
      const frames=report.frames.map((frame,i)=>({
        frameId:"frame-"+(i+1),
        sourceAxialIndex:selected.members.findIndex(m=>
          m.id===frame.fileId&&m.metadata.sopInstanceUid===frame.sopInstanceUid),
      }));
      if(frames.some(f=>f.sourceAxialIndex<0))throw Error("CLN source slice missing");
      clnSpatial=createClnFrameRelativeEvidence({
        sourceImageSha256:sourceBoundCln.sourceNiftiSha256,
        detectorSourceImageSha256:sourceBoundCln.sourceNiftiSha256,
        imageDimensions:sourceBoundCln.dimensions,
        reviewedFrames:frames,alignment:"source-dicom-pixel-to-png",
        nativeCandidates:sourceBoundCln.candidates.map(c=>({
          componentId:c.componentId,sourceVoxelCentroidIJK:c.sourceVoxelCentroidIJK,
          candidateVolumeMl:c.candidateVolumeMl,
        })),
      });
    }catch{clnSpatial=null;}
  }
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
    // Prevent a previous patient/study result from arriving after source change.
    detectorController.current?.abort();
    setDetectorBusy(false);
    setIchWorkerReady(false);
    setIchWorkerNotice("");
    // Selection changes must invalidate old source pixels AND prepare the
    // new eligible preview in the SAME reset effect. A one-shot ref was unsafe
    // under React Strict Mode: the second effect replay cleared the preview,
    // but its ref then blocked the second automatic preparation.
    // A requested frame-count change, unlike a Strict Mode effect replay,
    // must discard the old privacy review until the new plan is confirmed.
    const frameCountChanged=previousRequested.current!==requested;
    previousRequested.current=requested;
    setReport(!frameCountChanged&&activeSeriesKey&&universal.status==="eligible_for_authorization"&&
      choice.status==="ready-for-local-preview"?choice:null);
    setDetectorResult(null);
    setUnifiedStarted(false);
    setNotice("");
    setThumbnails({});
  }, [series, activeSeriesKey, requested, universal, choice]);
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
  const startUnified = () => {
    const selected=series.find(s=>s.key===activeSeriesKey)??null;
    if(!selected||universal.status!=="eligible_for_authorization")return;
    detectorController.current?.abort();
    const controller=new AbortController();
    detectorController.current=controller;
    setUnifiedStarted(true);
    setReport(choice.status==="ready-for-local-preview"?choice:null);
    setDetectorResult(null);
    setDetectorBusy(true);
    setIchWorkerReady(false);
    setIchWorkerNotice("");
    const sessionSnapshot={endpoint:ichEndpoint,token:ichToken};
    void (async()=>{
      let checkedRuntime:InstalledIanpanRuntime|null=null;
      let reason="";
      // One existing launch: an optional authentic model runs only if the
      // curator's exact public DICOM bytes are installed on a trusted worker.
      if(ichResearchConfirmed && ichToken && selected.modality==="CT" &&
          selected.members.every(m=>m.metadata.bodyRegion==="HEAD")){
        try{
          setIchWorkerNotice("Проверяем оригинальные ICH-веса на изолированном worker...");
          await checkPublicIchWorker(sessionSnapshot,controller.signal);
          if(controller.signal.aborted)return;
          checkedRuntime={
            ready:true,modelId:IANPAN_MODEL_ID,modelRevision:IANPAN_MODEL_REVISION,
            dataPolicy:"public-reference-only",
            run:async (s,signal)=>{
              try{return await runPublicIchWorker(sessionSnapshot,s,fileById,
                signal??controller.signal,setIchWorkerNotice);}
              catch(error){
                if(!controller.signal.aborted)
                  setIchWorkerNotice("ICH worker отказал: "+(error instanceof Error?error.message:"инференс недоступен"));
                throw error;
              }
            },
          };
          setIchWorkerReady(true);
        }catch(error){
          if(controller.signal.aborted)return;
          reason=error instanceof Error?error.message:"ICH worker недоступен.";
          setIchWorkerNotice("ICH не запущен: "+reason);
        }
      }
      const actual=installedDetectorRegistry({
        capturedSpecialist,capturedLaa950,ichRuntime,
        publicResearchAuthorized:publicResearchAuthorized||ichResearchConfirmed,
        ianpanRuntime:checkedRuntime,
      });
      const result=await dispatchDicomDetectors(selected,actual.executors,controller.signal);
      if(controller.signal.aborted)return;
      setDetectorResult(result);
      if(reason)setNotice("Локальная часть: "+reason+" Другие совместимые исполнители проверены.");
    })()
      .catch(()=>{if(!controller.signal.aborted)setNotice("Локальный этап не завершился. Отсутствие Evidence не исключает патологию.");})
      .finally(()=>{if(!controller.signal.aborted)setDetectorBusy(false);});
    setNotice("Единый маршрут запущен: проверяем локальные модели; разрешённые Gemini/Opus требуют отдельного обезличивания и подтверждения.");
  };
  const exportLocalDetectorReview=()=>{
    const selected=series.find(s=>s.key===activeSeriesKey)??null;
    if(!selected||!detectorResult||detectorBusy){
      setNotice("Нет завершённого локального исследования для врачебного экспорта.");
      return;
    }
    try{
      const report=createLocalDetectorReview(selected,detectorResult,new Date().toISOString());
      const json=JSON.stringify(report,null,2);
      if(new TextEncoder().encode(json).byteLength>2*1024*1024)
        throw Error("Export exceeds 2 MiB");
      const objectUrl=URL.createObjectURL(new Blob([json],{type:"application/json"}));
      try{
        const link=document.createElement("a");
        link.href=objectUrl;link.download="opus-local-detector-physician-draft.json";
        document.body.appendChild(link);link.click();link.remove();
      }finally{window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
      setNotice("Исследовательский черновик сохранён локально. В нём содержатся исходные DICOM UID; не загружайте файл в публичные сервисы.");
    }catch{
      setNotice("Источник или происхождение модели изменились: экспорт локального заключения запрещён.");
    }
  };

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
  const stablePrivacyPreviews=useMemo(()=>report?.frames.map(f=>thumbnails[f.fileId]?.url)??[],[report,thumbnails]);
  const extraView=<section className="ora-vision-plan" aria-label="Дополнительный анализ отдельных кадров">
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
    {!primaryActionAvailable&&<div className="ora-vision-plan-controls">
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
    </div>}
    {!fromPrimaryAnalysis&&!primaryActionAvailable&&<div className="ora-vision-budget-preview" aria-label="Единый запуск КТ МРТ">
      <strong>Единый анализ · детекторы + Gemini + Opus</strong>
      <p>Одна точка входа: запуск доступных локальных моделей, затем проверка копий и разрешённый вызов Gemini + Opus в этой же панели.</p>
      <button type="button" disabled={detectorBusy||universal.status!=="eligible_for_authorization"} onClick={startUnified}>
        {detectorBusy?"Запускаем локальный этап…":"Запустить единый анализ КТ/МРТ"}
      </button>
      {unifiedStarted&&<p role="status">Локальный этап выполнен или выполняется. Для облачного этапа ниже проверьте OCR, снимки и разрешения провайдера; без этого анализ моделей не запускается. Частичная выборка не равна оценке всей серии.</p>}
      <details>
        <summary>Дополнительно · настоящий ICH-детектор на исследовательском Linux worker</summary>
        <p>Только разрешённая публичная КТ, заранее установленная на worker. В браузере вычисляются SHA-256 файлов; сами DICOM-пиксели не передаются. Не подходит для исследований пациентов.</p>
        <label>Адрес локального SSH-туннеля ICH worker
          <input type="text" value={ichEndpoint} disabled={detectorBusy}
            onChange={e=>{setIchEndpoint(e.target.value);setIchWorkerReady(false);}} />
        </label>
        <label>Сессионный токен ICH worker
          <input type="password" autoComplete="off" value={ichToken} disabled={detectorBusy}
            onChange={e=>{setIchToken(e.target.value);setIchWorkerReady(false);}} />
        </label>
        <label><input type="checkbox" checked={ichResearchConfirmed} disabled={detectorBusy}
          onChange={e=>{setIchResearchConfirmed(e.target.checked);setIchWorkerReady(false);}} />
          Подтверждаю: это разрешённая публичная КТ, точно совпадающая с предварительно проверенными данными worker; не пациентское исследование.</label>
        {ichWorkerNotice&&<p role="status">{ichWorkerNotice}</p>}
        <p>Запуск ICH не требует второй кнопки: после настройки он входит в «Запустить единый анализ КТ/МРТ» выше.</p>
      </details>
    </div>}
    {fromPrimaryAnalysis&&<div role="status" aria-label="Этапы единого исследования">
      <strong>Один запуск · два независимых пути</strong>
      <ol>
        <li>Исходные DICOM и серия проверены</li>
        <li>{primaryAnalysisStage==="running"?"Оригинальные детекторы выполняются…":
          primaryAnalysisStage==="completed"?"Запуск диагностических детекторов завершён":
          primaryAnalysisStage==="vision-only"?"Совместимый оригинальный детектор не назначен — доступен независимый Vision":
          primaryAnalysisStage==="cancelled"?"Детекторы отменены":"Ожидание запуска детекторов"}</li>
        <li>Кадры Vision подготавливаются независимо и локально, OCR запускается автоматически — врачу остаётся проверить изображения</li>
        <li>После завершения детекторов и разрешения врача Gemini и Opus сформируют единое заключение TXT</li>
      </ol>
      {primaryAnalysisStage==="running"&&<p>Пока модель работает, можно осматривать изображения; отправка Gemini/Opus откроется после её завершения.</p>}
    </div>}
    <div className="ora-vision-budget-preview" role="status" aria-label="Универсальный анализ КТ и МРТ">
      <strong>Gemini + Opus · универсальный анализ {universal.modality==="CT"?"КТ":universal.modality==="MR"?"МРТ":"DICOM"}</strong>
      <p>{universal.reason}</p>
      <p>Универсальный маршрут не зависит от установленных детекторов. Подготовка кадров и отдельное разрешение облачной передачи выполняются ниже; готовность маршрута не означает, что изображения уже проанализированы.</p>
    </div>
    <details className="ora-vision-budget-preview" aria-label="Локальный маршрут диагностического консилиума">
      <summary>Дополнительно · доступные детекторы и модельные находки</summary>
      <strong>Диагностический консилиум · автоматический маршрут</strong>
      {consilium.status === "ready" ? <>
        <p>Выбранные специалисты Gemini: {consilium.specialists.join(", ")}.</p>
        <p>Диагностические направления-кандидаты: {consilium.detectorTargets.join(", ")}.</p>
        <p>Claude Opus сопоставляет независимые результаты детекторов и визуальных специалистов после их фактического выполнения.</p>
        <p>Статус: зарегистрировано {registered.executors.length} реально доступных локальных исполнителей. Запуск выполняется единой кнопкой выше, без передачи DICOM в облако.</p>
        {registered.unavailable.filter(item=>consilium.detectorTargets.includes(item.target)).map(item=>
          <p key={item.target} role="status">{item.target}: {item.reason}</p>)}
        {detectorResult && <div role="status">
          <p>Выполнено локальных исполнителей: {detectorResult.executed.length}; из них патологических детекторов: {detectorResult.executed.filter(target=>target!=="lung-low-attenuation-quantification").length}. Получено Evidence: {detectorResult.evidence.length}.</p>
          <p>Не подключено или заблокировано направлений: {detectorResult.blocked.length}.</p>
          {detectorResult.blocked.map(item => <p key={item.target}>{item.target}: {item.reason === "No registered executable model" ? "исполнитель с проверенными весами пока не подключён" : item.reason}</p>)}
          {detectorResult.evidence.flatMap(e => e.warnings).map((warning,i)=><p key={i}>{warning}</p>)}
          {detectorResult.evidence.flatMap(e=>e.findings).map((finding,i)=>{
            const source=series.find(s=>s.key===activeSeriesKey)?.members.find(m=>
              m.metadata.seriesUid===finding.source.seriesUid &&
              m.metadata.sopInstanceUid===finding.source.sopInstanceUid);
            return <p key={finding.findingId+"-"+i}>
              <strong>{finding.anatomy}: {finding.sign}</strong> · кандидат, требует проверки врача.
              {source ? <button type="button" onClick={()=>onOpenSlice(source.id)}>Открыть исходный DICOM-срез</button> :
                " Исходный DICOM-срез недоступен; навигация заблокирована."}
            </p>;
          })}

          <p>Неподписанный локальный врачебный черновик сохраняет фактические исполнители, неподтверждённые находки, отсутствующие модели и координаты исходных DICOM. Отрицательное заключение из пустого результата не формируется.</p>
          <button type="button" onClick={exportLocalDetectorReview} disabled={detectorBusy}>
            Сохранить локальный врачебный черновик Evidence
          </button>
          <p>Файл содержит исходные SOP UID и предназначен только для локального врачебного просмотра. В облако не отправляется.</p>
          <p>R231/LAA−950 — количественный исследовательский показатель, не диагностический детектор эмфиземы. Отсутствие результатов не исключает патологию. Изображения никуда не передавались.</p>
        </div>}
      </> : <p role="status">{consilium.reason}</p>}
    </details>
    <details className="ora-vision-budget-preview" aria-label="Бюджет полного обзора Gemini">
      <summary>Дополнительно · расчёт полного обзора (не запущен)</summary>
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
    </details>
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
          <button type="button" onClick={() => onOpenSlice(frame.fileId)}>Открыть срез Vision в DICOM</button>
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
      <VisionPrivacyPreparation autoStartAfterDetectors={fromPrimaryAnalysis}
        primaryAnalysisStage={primaryAnalysisStage}
        originalDetectorEvidence={originalDetectorEvidence}
        frameRelativeClnEvidence={clnSpatial}
        key={JSON.stringify(report.frames.map(f=>f.fileId))+requested}
        previews={stablePrivacyPreviews}
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
  const selected=series.find(s=>s.key===choice.seriesKey);
  if(!fromPrimaryAnalysis||!selected||!fullVolumeCost)return extraView;
  return <section className="ora-vision-plan" aria-label="Автоматический анализ исследования">
    <FullVolumeLocalPreparation key={"study-"+selected.key}
      series={selected} files={fileById}
      flaggedIndex={targetFrame.trim()?Number(targetFrame)-1:null}
      autoStart={true} detectorStage={primaryAnalysisStage}
      detectorEvidence={originalDetectorEvidence} onOpenSlice={onOpenSlice}/>
    <details>
      <summary onClick={()=>setExtraOpened(true)}>Дополнительно · анализ отдельных срезов</summary>
      {extraOpened&&extraView}
    </details>
  </section>;
}
