"use client";

import { useEffect, useRef, useState } from "react";
import LocalLungmaskPanel from "./LocalLungmaskPanel";
import SegmentationEvidenceReview from "./SegmentationEvidenceReview";
import { buildSegmentationEvidence, type SegmentationEvidence } from "../lib/segmentation-evidence";
import type {Laa950CpuResearch} from "../lib/cpu-lung-laa950";
import type { AnalysisStream } from "../lib/analysis-stream";
import {parseResearchAnatomy, type AnatomyProof} from "../lib/totalseg-abdomen-import";
import {buildResearchAnatomyRegions, type LobeRegion} from "../lib/totalseg-lobe-navigation";
import { maskColor, MAX_MASK_FILE_BYTES, readNiftiMaskFile, type LabelMask, type Point3 } from "../lib/segmentation-mask";
import { assertResultBinding, MAX_RESULT_JSON_BYTES, parseSegmentationResult, sha256, type AnalysisPackage, type AnalysisRequest, type SegmentationResult } from "../lib/analysis-package";

export type MaskDisplay = { visible: boolean; opacity: number; label: number | null };
type Summary = { name: string; labels: LabelMask["labels"]; result?: SegmentationResult; evidence?: SegmentationEvidence; evidenceRevision?: number; fullCtDerived?:boolean; research?:AnatomyProof; researchRegions?:LobeRegion[]; researchSourceVerified?:boolean };
type DownloadPackage = { request: AnalysisRequest; volumeUrl: string; manifestUrl: string };

export default function SegmentationControls({ ready, onPrepare, onPrepareStream, onImport, onDisplay, onClear, onNavigatePoint, onSampleMask,onFullCtLoad,onVerifyResearchSource,onEvidenceChange,onQuantifyLaa950 }: {
  ready: boolean;
  onPrepare: (signal: AbortSignal) => Promise<AnalysisPackage>;
  onPrepareStream: (signal: AbortSignal) => Promise<AnalysisStream>;
  onImport: (mask: LabelMask, display: MaskDisplay) => void;
  onDisplay: (display: MaskDisplay) => void;
  onClear: () => void;
  onNavigatePoint: (point: Point3) => void;
  onSampleMask: (point: Point3) => number | null;
  onFullCtLoad?: (signal:AbortSignal)=>Promise<LabelMask>;
  onEvidenceChange?: (evidence:SegmentationEvidence|null)=>void;
  onQuantifyLaa950?: (evidence:SegmentationEvidence,operatorConfirmed:boolean,signal:AbortSignal)=>Promise<Laa950CpuResearch>;
  onVerifyResearchSource?: (passportJson:string,proof:AnatomyProof,signal:AbortSignal)=>Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const researchInput = useRef<HTMLInputElement>(null);
  const resultInput = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const preparation = useRef<AbortController | null>(null);
  const researchController=useRef<AbortController|null>(null);
  const packageRef = useRef<DownloadPackage | null>(null);
  const callbacks = useRef({ onPrepare, onPrepareStream, onImport, onDisplay, onClear, onNavigatePoint,onVerifyResearchSource,onEvidenceChange });
  callbacks.current = { onPrepare, onPrepareStream, onImport, onDisplay, onClear, onNavigatePoint,onVerifyResearchSource,onEvidenceChange };
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [display, setDisplay] = useState<MaskDisplay>({visible:true,opacity:0.4,label:null});
  const [packet, setPacket] = useState<DownloadPackage | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [localCommandCopied, setLocalCommandCopied] = useState(false);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [laaConfirmed,setLaaConfirmed]=useState(false);
  const [laaBusy,setLaaBusy]=useState(false);
  const [laaError,setLaaError]=useState("");
  const [laaResult,setLaaResult]=useState<Laa950CpuResearch|null>(null);
  const laaController=useRef<AbortController|null>(null);
  useEffect(()=>{
    laaController.current?.abort();
    setLaaResult(null);setLaaError("");setLaaConfirmed(false);setLaaBusy(false);
  },[summary?.evidenceRevision,summary?.name,ready]);
  const quantifyLaa=async()=>{
    if(!onQuantifyLaa950||!summary?.evidence||!laaConfirmed||laaBusy||!ready)return;
    const evidence=summary.evidence,controller=new AbortController();
    laaController.current?.abort();laaController.current=controller;
    setLaaBusy(true);setLaaError("");setLaaResult(null);
    try{
      const measured=await onQuantifyLaa950(evidence,true,controller.signal);
      if(!controller.signal.aborted)setLaaResult(measured);
    }catch(e){
      if(!controller.signal.aborted)setLaaError(e instanceof Error?e.message:"Расчёт HU остановлен");
    }finally{
      if(laaController.current===controller){laaController.current=null;setLaaBusy(false);}
    }
  };
  useEffect(()=>{
    if(!onFullCtLoad){version.current++;preparation.current?.abort();researchController.current?.abort();setBusy(false);
      setSummary(current=>{if(current?.fullCtDerived){callbacks.current.onClear();callbacks.current.onEvidenceChange?.(null);return null;}return current;});}
  },[Boolean(onFullCtLoad)]);
  const localOnnxCommand = packet ? [
    'cd "$HOME/Desktop/opus-radiology-ai-github"',
    'source .venv-local-ai/bin/activate',
    'python3 scripts/run-local-onnx.py ' +
      '--input "$HOME/Downloads/opus-' + packet.request.requestId + '_0000.nii" ' +
      '--request "$HOME/Downloads/opus-' + packet.request.requestId + '.request.json" ' +
      '--model "$HOME/Models/Opus/model.onnx" ' +
      '--profile "$HOME/Models/Opus/model.profile.json" ' +
      '--mask "$HOME/Downloads/opus-' + packet.request.requestId + '.mask.nii" ' +
      '--result "$HOME/Downloads/opus-' + packet.request.requestId + '.result.json"',
  ].join('\n') : "";


  const releasePackage = () => {
    const previous = packageRef.current;
    if (previous) {URL.revokeObjectURL(previous.volumeUrl);URL.revokeObjectURL(previous.manifestUrl);}
    packageRef.current=null;
  };

  useEffect(() => () => { version.current++;preparation.current?.abort();researchController.current?.abort();releasePackage(); }, []);
  useEffect(() => {
    if (!ready) {
      version.current++;preparation.current?.abort();researchController.current?.abort();releasePackage();
      setPacket(null);setExportBusy(false);setExportError("");setSummary(null);setBusy(false);setError("");
      callbacks.current.onEvidenceChange?.(null);
    }
  }, [ready]);

  const prepare = async () => {
    const request=++version.current, controller=new AbortController();
    preparation.current?.abort();preparation.current=controller;
    setExportBusy(true);setExportError("");
    let volumeUrl: string | null=null, manifestUrl: string | null=null;
    try {
      const generated=await callbacks.current.onPrepare(controller.signal);
      if (request!==version.current || controller.signal.aborted) return;
      volumeUrl=URL.createObjectURL(new Blob([generated.buffer],{type:"application/octet-stream"}));
      manifestUrl=URL.createObjectURL(new Blob([JSON.stringify(generated.request,null,2)],{type:"application/json"}));
      releasePackage();
      const next={request:generated.request,volumeUrl,manifestUrl};
      packageRef.current=next;setPacket(next);volumeUrl=null;manifestUrl=null;
    } catch(cause) {
      if (request===version.current && !controller.signal.aborted) setExportError(cause instanceof Error?cause.message:String(cause));
    } finally {
      if (volumeUrl) URL.revokeObjectURL(volumeUrl);
      if (manifestUrl) URL.revokeObjectURL(manifestUrl);
      if (request===version.current) {setExportBusy(false);preparation.current=null;}
    }
  };

  const load = async (file: File) => {
    const request = ++version.current;researchController.current?.abort();
    setBusy(true); setError("");
    try {
      const mask = await readNiftiMaskFile(file);
      if (request !== version.current) return;
      const next = {visible:true,opacity:0.4,label:mask.labels[0]?.id??null};
      // Runtime validates physical geometry before replacing an existing overlay.
      callbacks.current.onImport(mask,next);
      setSummary({name:file.name,labels:mask.labels}); setDisplay(next);
       callbacks.current.onEvidenceChange?.(null);
    } catch(cause) {
      if (request === version.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (request === version.current) setBusy(false); }
  };
  const loadResearch = async (files: File[]) => {
    const revision=++version.current;
    researchController.current?.abort();
    const controller=new AbortController();researchController.current=controller;
    setBusy(true);setError("");
    try {
      const masks=files.filter(f=>f.name.toLowerCase().endsWith(".nii"));
      const json=files.filter(f=>f.name.toLowerCase().endsWith(".json"));
      if(files.length!==2||masks.length!==1||json.length!==1)
        throw Error("Выберите одну исследовательскую маску .nii и один паспорт .json.");
      if(!masks[0].size||masks[0].size>MAX_MASK_FILE_BYTES||!json[0].size||json[0].size>65536)
        throw Error("Недопустимый размер файла исследовательской маски или паспорта.");
      const digest=await sha256(await masks[0].arrayBuffer());
      const mask=await readNiftiMaskFile(masks[0]);
      const passport=await json[0].text();
      const research=parseResearchAnatomy(passport,mask,digest);
      if(!callbacks.current.onVerifyResearchSource)
        throw Error("Проверка источника DICOM не подключена. Исследовательская маска заблокирована.");
      await callbacks.current.onVerifyResearchSource(passport,research,controller.signal);
      if(revision!==version.current||controller.signal.aborted)return;
      const researchRegions=await buildResearchAnatomyRegions(mask,research,{cancelled:()=>revision!==version.current||controller.signal.aborted});
      if(revision!==version.current||controller.signal.aborted)return;
      // The exact selected DICOM byte hashes were compared to the research manifest.
      // MPR also independently validates physical geometry.
      const next={visible:true,opacity:0.4,label:null};
      callbacks.current.onImport(mask,next);
      setSummary({name:masks[0].name,labels:mask.labels,research,researchRegions,researchSourceVerified:true});
      setDisplay(next);
       callbacks.current.onEvidenceChange?.(null);
    } catch(cause){
      if(revision===version.current)setError(cause instanceof Error?cause.message:String(cause));
    } finally {if(revision===version.current){setBusy(false);researchController.current=null;}}
  };
  const loadResult = async (files: File[]) => {
    const request=++version.current;researchController.current?.abort();
    setBusy(true);setError("");
    try {
      const active=packageRef.current;
      if (!active) throw new Error("Сначала подготовьте пакет выбранной серии.");
      const json=files.filter(f=>f.name.toLowerCase().endsWith(".json"));
      const masks=files.filter(f=>/\.nii(\.gz)?$/i.test(f.name));
      if (files.length!==2||json.length!==1||masks.length!==1) throw new Error("Выберите вместе одну NIfTI-маску и один JSON-паспорт результата.");
      if (json[0].size>MAX_RESULT_JSON_BYTES||masks[0].size>MAX_MASK_FILE_BYTES) throw new Error("Превышен лимит размера маски или паспорта.");
      const result=parseSegmentationResult(await json[0].text());
      const maskSha256=await sha256(await masks[0].arrayBuffer());
      const mask=await readNiftiMaskFile(masks[0]);
      if (request!==version.current) return;
      assertResultBinding(result,active.request,mask,maskSha256);
      const evidence=await buildSegmentationEvidence(active.request,result,mask,maskSha256);
      if (request!==version.current) return;
      const next={visible:true,opacity:0.4,label:mask.labels[0]?.id??null};
      callbacks.current.onImport(mask,next);
      setSummary({name:masks[0].name,labels:mask.labels,result,evidence,evidenceRevision:request});setDisplay(next);
      callbacks.current.onEvidenceChange?.(evidence);
    } catch(cause) {
      if (request===version.current) setError(cause instanceof Error?cause.message:String(cause));
    } finally {if (request===version.current) setBusy(false);}
  };
  const change = (next: MaskDisplay) => {
    try { callbacks.current.onDisplay(next);setDisplay(next);setError(""); }
    catch(cause) {setError(cause instanceof Error ? cause.message : String(cause));}
  };
  const selected = display.label===null ? null : summary?.labels.find(l=>l.id===display.label);
  const loadFull=async()=>{
    if(!onFullCtLoad)return;researchController.current?.abort();const revision=++version.current,controller=new AbortController();
    preparation.current?.abort();preparation.current=controller;setBusy(true);setError("");
    try{const mask=await onFullCtLoad(controller.signal);if(revision!==version.current||controller.signal.aborted)return;
      const next={visible:true,opacity:0.4,label:null};callbacks.current.onImport(mask,next);
      setSummary({name:"R231 · привязанный фрагмент полного задания (Evidence — в полной КТ)",labels:mask.labels,fullCtDerived:true});setDisplay(next);
      callbacks.current.onEvidenceChange?.(null);
    }catch(e){if(revision===version.current)setError(e instanceof Error?e.message:"Ошибка фрагмента полной маски.");}
    finally{if(revision===version.current){setBusy(false);preparation.current=null;}}
  };
  const voxels = selected?.voxels ?? summary?.labels.reduce((n,l)=>n+l.voxels,0) ?? 0;
  const volumeMl = selected?.volumeMl ?? summary?.labels.reduce((n,l)=>n+l.volumeMl,0) ?? 0;

  return <section className="ora-mask-controls" aria-label="Готовая сегментационная маска">
    <div className="ora-mask-heading"><strong>Сегментация · готовая маска</strong><span>Локальный импорт</span></div>
    <p>Загрузите NIfTI-маску именно выбранной DICOM-серии. Проверяются размеры, положение и ориентация. Для открытой исследовательской КТ доступна опциональная локальная Lungmask R231 после отдельной установки.</p>
    {onFullCtLoad&&<button type="button" disabled={!ready||busy||exportBusy||workerBusy} onClick={()=>void loadFull()}>Показать маску полного задания для этого фрагмента</button>}
    <LocalLungmaskPanel ready={ready&&!busy&&!exportBusy&&!onFullCtLoad} onBusy={setWorkerBusy}
      onPrepare={signal=>callbacks.current.onPrepareStream(signal)} onResult={(mask,result,evidence)=>{
        const next={visible:true,opacity:0.4,label:null};
        callbacks.current.onImport(mask,next);
        setSummary({name:"Lungmask R231 · локальный worker",labels:mask.labels,result,evidence,evidenceRevision:++version.current});setDisplay(next);setError("");
        callbacks.current.onEvidenceChange?.(evidence);
      }}/>
    <div className="ora-mask-actions">
      <button type="button" disabled={!ready||busy||exportBusy||workerBusy} onClick={()=>input.current?.click()}>{busy ? "Проверка маски…" : summary ? "Заменить маску .nii / .nii.gz" : "Загрузить маску .nii / .nii.gz"}</button>
      <button type="button" disabled={!ready||busy||exportBusy||workerBusy} onClick={()=>researchInput.current?.click()}>Маска TotalSegmentator + паспорт исследования</button>
      <input type="file" ref={researchInput} hidden multiple accept=".nii,.json" onChange={event=>{
        const files=Array.from(event.target.files??[]);
        event.target.value="";
        if(files.length&&ready)void loadResearch(files);
      }}/>
      {summary && <button type="button" disabled={exportBusy||workerBusy} onClick={()=>{
        version.current++; researchController.current?.abort();callbacks.current.onClear();setSummary(null);setBusy(false);setError("");
        callbacks.current.onEvidenceChange?.(null);
      }}>Удалить маску</button>}
      <input ref={input} type="file" accept=".nii,.nii.gz" hidden onChange={event=>{
        const file=event.target.files?.[0];event.target.value="";
        if(file&&ready)void load(file);
      }}/>
    </div>
    {error && <p className="ora-mask-error" role="alert">{error} {summary ? "Предыдущая маска сохранена." : "Маска не подключена."}</p>}
    {summary && <>
      <p className="ora-mask-success" role="status">Сетка совмещена · {summary.name} · меток: {summary.labels.length}</p>
      <small>Совпадение геометрии не подтверждает пациента или правильность сегментации. Проверьте принадлежность файла выбранной серии и границы на всех плоскостях.</small>
      <p className="ora-mask-coverage" role="note">Полнота анатомического охвата не подтверждена. Объём разметки относится только к загруженным срезам, а не ко всему органу.</p>
      {summary.research && <details className="ora-mask-provenance" open>
        <summary>Исследовательская разметка TotalSegmentator · {summary.research.anatomy==="abdomen"?"органы брюшной полости":"доли лёгких"}</summary>
        <p>Срезы исходной серии: {summary.research.firstSlice}–{summary.research.lastSlice} (индексы с нуля);
          полный объём: {summary.research.fullDimensions.join(" × ")}.</p>
        {summary.research.missingLabels.length ?
          <p role="alert">Требуют проверки отсутствующие метки: {summary.research.missingLabels.map(id=>summary.research!.labelNames[id]).join(", ")}.</p> :
          <p>Все {summary.research.anatomy==="abdomen"?"четыре":"пять"} меток присутствуют, но правильность анатомических границ не подтверждена.</p>}
        {summary.researchSourceVerified&&<p role="status">SHA-256 загруженных исходных DICOM-срезов подтверждены по исследовательскому паспорту.</p>}
        <small>SHA-256 маски и число вокселей совпадают с паспортом. JSON не подписан;
          SHA подтверждает совпадение текущих файлов с заявленным источником, но не удостоверяет автора, пациента, модель или клиническую точность. Только исследовательский режим.</small>
      </details>}
      {summary.research && summary.researchRegions && <section className="ora-mask-settings" aria-label="Навигация по анатомическим структурам">
        <h3>Найденные анатомические структуры · обзор на MPR</h3>
        <p>Выберите структуру, чтобы перейти к занятому ею вокселю на исходных срезах.
          Точка выбрана по центру разметки, а не по подозрению на патологию.</p>
        <ul>{summary.researchRegions.map(region=><li key={region.id}>
          <strong>{region.name}</strong> · {region.voxels.toLocaleString("ru-RU")} вокселей
          · {region.volumeMl.toFixed(2)} мл в пределах загруженного фрагмента
          · срезы {region.originalSliceRange[0]}–{region.originalSliceRange[1]}
          {" "}<button type="button" disabled={!ready||busy} onClick={()=>{
            try {
              callbacks.current.onNavigatePoint(region.anchorLpsMm);
              change({...display,visible:true,label:region.id});
            } catch(cause) {setError(cause instanceof Error?cause.message:"Не удалось открыть долю в MPR.");}
          }}>Показать структуру в MPR</button>
        </li>)}</ul>
        <small>Объёмы относятся только к выделенным срезам. Границы и патологию должен проверить врач;</small>
        <small>навигация не подтверждает анатомическую точность или полный охват органа. Для MSD Task09 доступен эталон только селезёнки; его Dice не относится к данному файлу автоматически.</small>
      </section>}
      {summary.result ? <details className="ora-mask-provenance">
        <summary>Суммы совпали · {summary.result.model.id} · сведения о модели</summary>
        <p>Заявленная модель: {summary.result.model.id} · {summary.result.model.version}. Задача: {summary.result.model.task}.</p>
        <small>Запрос: {summary.result.requestId}<br/>SHA-256 весов: {summary.result.model.weightsSha256}</small>
        {summary.result.limitations.length>0 && <ul>{summary.result.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul>}
        <small>Паспорт не подписан. Контрольные суммы не удостоверяют автора модели, клиническую точность или применимость к последовательности.</small>
      </details> : !summary.research && <p className="ora-mask-binding-note">Проверена только геометрия. Связь с пакетом серии и сведения о модели не проверены.</p>}
      {summary.labels.length ? <>
        <div className="ora-mask-settings">
          <label className="ora-mask-visible"><input type="checkbox" checked={display.visible} onChange={event=>change({...display,visible:event.target.checked})}/> Показать на MPR</label>
          <label>Метка<select value={display.label??"all"} onChange={event=>change({...display,label:event.target.value==="all" ? null : Number(event.target.value)})}>
            <option value="all">Все метки</option>
            {summary.labels.map(l=><option value={l.id} key={l.id}>Метка {l.id}{summary.result ? ` · ${summary.result.labels.find(item=>item.id===l.id)?.name}` : summary.research ? ` · ${summary.research.labelNames[l.id]}` : ""} · {l.voxels.toLocaleString("ru-RU")} вокселей</option>)}
          </select></label>
          <label>Непрозрачность: {Math.round(display.opacity*100)}%<input type="range" min="0" max="80" value={Math.round(display.opacity*100)} onChange={event=>change({...display,opacity:Number(event.target.value)/100})}/></label>
        </div>
        <p className="ora-mask-quantification">{selected && <i aria-hidden="true" style={{background:`rgb(${maskColor(selected.id).join(",")})`}}/>}{selected ? (summary?.research?.labelNames[selected.id]??`Метка ${selected.id}`) : "Все метки"}: {voxels.toLocaleString("ru-RU")} вокселей · объём разметки ≈ {volumeMl.toFixed(3)} мл.</p>
        <small>Объём рассчитан по меткам и геометрии маски; это не оценка точности модели. Названия из паспорта заявлены поставщиком результата. Маска отображается поверх MPR, без 3D-поверхностей.</small>
      </> : <p>Маска не содержит ненулевых меток. Это не подтверждает отсутствие патологических изменений.</p>}
    </>}
    {summary?.evidence?.producer.model.id==="lungmask-R231"&&
      summary.evidence.producer.executionMode==="local"&&onQuantifyLaa950&&
      <details className="ora-lung-laa950">
        <summary>CPU: LAA−950 в маске R231 · только фрагмент КТ</summary>
        <p>Подсчёт настоящих декодированных КТ-вокселей ≤−950 HU внутри исходной
          маски R231. Модель не диагностирует эмфизему или ХОБЛ.
          Полнота обоих лёгких не доказана; результаты зависят от протокола КТ.</p>
        <label><input type="checkbox" checked={laaConfirmed} disabled={laaBusy}
          onChange={e=>{setLaaConfirmed(e.target.checked);setLaaResult(null);}}/>
          Я проверил исходное исследование: инспираторная КТ без внутривенного контраста,
          реконструкция подходит для денситометрии; понимаю, что выборка может быть неполной.
        </label>
        <div className="ora-mask-actions">
          <button type="button" disabled={!laaConfirmed||!ready||laaBusy||busy}
            onClick={()=>void quantifyLaa()}>
            {laaBusy?"Идёт подсчёт HU…":"Измерить LAA−950 локально на CPU"}
          </button>
          {laaBusy&&<button type="button" onClick={()=>laaController.current?.abort()}>Отменить</button>}
        </div>
        {laaError&&<p role="alert" className="ora-mask-error">{laaError}</p>}
        {laaResult&&<div role="status">
          <p><strong>Результат только по обработанному фрагменту:</strong>
            {" "}{laaResult.totalMaskLowAttenuationPct.toFixed(2)}% маски имеют плотность ≤−950 HU.
            Не экстраполировать на лёгкие целиком.</p>
          <ul>{laaResult.lungs.map(x=><li key={x.label}>
            {x.anatomy==="right"?"Правое лёгкое":"Левое лёгкое"}:
            {" "}{x.lowAttenuationPctOfSampledMask.toFixed(2)}%,
            {" "}{x.lowAttenuationVolumeMl.toFixed(2)} мл из {x.maskVolumeMl.toFixed(2)} мл маски
            ({x.maskVoxelCount.toLocaleString("ru-RU")} вокселей)
          </li>)}</ul>
          <small>Результат не подтверждает полноценность КТ и точность HU-трансформации.
            Отсутствие низкоплотных вокселей в фрагменте не исключает болезнь.
            Расчёт полностью локальный, не добавляет вызовов Gemini/Opus.</small>
        </div>}
      </details>}
    {summary?.evidence&&<SegmentationEvidenceReview key={summary.evidenceRevision}
      evidence={summary.evidence} onSampleMask={onSampleMask} onNavigate={(point,labelId)=>{
        callbacks.current.onNavigatePoint(point);
        change({...display,visible:true,label:labelId});
      }}/>}
    <details className="ora-analysis-package">
      <summary>Пакет полного объёма для AI Engine</summary>
      <p>Подготовьте выбранную серию как NIfTI и паспорт. Оба файла скачиваются отдельно; приложение не отправляет их на сервер.</p>
      <small>В пакет входит одна серия. Последовательность и полнота анатомического покрытия не подтверждены. Изображение может содержать идентифицирующую информацию; удаление DICOM-тегов не гарантирует обезличивания.</small>
      <div className="ora-mask-actions">
        <button type="button" disabled={!ready||busy||exportBusy||workerBusy} onClick={()=>void prepare()}>{exportBusy ? "Подготовка объёма…" : packet ? "Подготовить новый пакет" : "Подготовить пакет серии"}</button>
        {exportBusy && <button type="button" onClick={()=>{
          version.current++;preparation.current?.abort();preparation.current=null;setExportBusy(false);
        }}>Отменить подготовку</button>}
      </div>
      {exportError && <p className="ora-package-error" role="alert">{exportError}</p>}
      {packet && <>
        <p className="ora-package-ready" role="status">Пакет готов · {packet.request.frameCount} кадров · {packet.request.geometry.dimensions.join(" × ")} · {packet.request.modality}</p>
        <div className="ora-package-downloads">
          <a href={packet.volumeUrl} download={`opus-${packet.request.requestId}_0000.nii`}>Скачать объём .nii</a>
          <a href={packet.manifestUrl} download={`opus-${packet.request.requestId}.request.json`}>Скачать паспорт .json</a>
        </div>
        <details className="ora-offline-model-instructions">
          <summary>Настоящий локальный AI на Mac · ONNX · без облака</summary>
          <p>Опциональный офлайн-модуль v1.9 запускает установленную на Mac модель
            на КТ/МРТ-серии, поддерживаемой конкретным ONNX-чекпойнтом.
            OpenRouter не вызывается. Пока необходимы проверенные веса и профиль модели.</p>
          <p>Скачайте оба файла выше, установите Python и ONNX Runtime согласно
            <a href="https://github.com/vasiliys961/opus-radiology-ai/blob/main/docs/LOCAL_ONNX_AI.md"
              target="_blank" rel="noreferrer"> руководству</a>.
            Модель и её профиль должны находиться в <code>~/Models/Opus</code>.</p>
          <pre>{localOnnxCommand}</pre>
          <button type="button" onClick={()=>{
            void navigator.clipboard.writeText(localOnnxCommand).then(
              ()=>setLocalCommandCopied(true),
              ()=>setLocalCommandCopied(false));
          }}>{localCommandCopied ? "Команда скопирована" : "Скопировать команду для Cursor"}</button>
          <p>После выполнения выберите «Импортировать результат модели» и одновременно
            два новых файла <code>.mask.nii</code> и <code>.result.json</code>.
            Врач проверяет маску на исходных срезах; отсутствие меток не доказывает отсутствие болезни.</p>
        </details>
        <small>Запрос: {packet.request.requestId}. Для импорта выберите вместе маску и паспорт результата этого пакета.</small>
        <div className="ora-mask-actions"><button type="button" disabled={busy||exportBusy||workerBusy||!ready} onClick={()=>resultInput.current?.click()}>Импортировать результат модели</button></div>
        <input ref={resultInput} type="file" accept=".json,.nii,.nii.gz" multiple hidden onChange={event=>{
          const files=Array.from(event.target.files??[]);event.target.value="";
          if (files.length && ready) void loadResult(files);
        }}/>
      </>}
    </details>
  </section>;
}
