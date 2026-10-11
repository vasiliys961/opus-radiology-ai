"use client";

import { useEffect, useRef, useState } from "react";
import LocalLungmaskPanel from "./LocalLungmaskPanel";
import type { AnalysisStream } from "../lib/analysis-stream";
import { maskColor, MAX_MASK_FILE_BYTES, readNiftiMaskFile, type LabelMask } from "../lib/segmentation-mask";
import { assertResultBinding, MAX_RESULT_JSON_BYTES, parseSegmentationResult, sha256, type AnalysisPackage, type AnalysisRequest, type SegmentationResult } from "../lib/analysis-package";

export type MaskDisplay = { visible: boolean; opacity: number; label: number | null };
type Summary = { name: string; labels: LabelMask["labels"]; result?: SegmentationResult };
type DownloadPackage = { request: AnalysisRequest; volumeUrl: string; manifestUrl: string };

export default function SegmentationControls({ ready, onPrepare, onPrepareStream, onImport, onDisplay, onClear }: {
  ready: boolean;
  onPrepare: (signal: AbortSignal) => Promise<AnalysisPackage>;
  onPrepareStream: (signal: AbortSignal) => Promise<AnalysisStream>;
  onImport: (mask: LabelMask, display: MaskDisplay) => void;
  onDisplay: (display: MaskDisplay) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const resultInput = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const preparation = useRef<AbortController | null>(null);
  const packageRef = useRef<DownloadPackage | null>(null);
  const callbacks = useRef({ onPrepare, onPrepareStream, onImport, onDisplay, onClear });
  callbacks.current = { onPrepare, onPrepareStream, onImport, onDisplay, onClear };
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [display, setDisplay] = useState<MaskDisplay>({visible:true,opacity:0.4,label:null});
  const [packet, setPacket] = useState<DownloadPackage | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [localCommandCopied, setLocalCommandCopied] = useState(false);
  const [workerBusy, setWorkerBusy] = useState(false);
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

  useEffect(() => () => { version.current++;preparation.current?.abort();releasePackage(); }, []);
  useEffect(() => {
    if (!ready) {
      version.current++;preparation.current?.abort();releasePackage();
      setPacket(null);setExportBusy(false);setExportError("");setSummary(null);setBusy(false);setError("");
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
    const request = ++version.current;
    setBusy(true); setError("");
    try {
      const mask = await readNiftiMaskFile(file);
      if (request !== version.current) return;
      const next = {visible:true,opacity:0.4,label:mask.labels[0]?.id??null};
      // Runtime validates physical geometry before replacing an existing overlay.
      callbacks.current.onImport(mask,next);
      setSummary({name:file.name,labels:mask.labels}); setDisplay(next);
    } catch(cause) {
      if (request === version.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (request === version.current) setBusy(false); }
  };
  const loadResult = async (files: File[]) => {
    const request=++version.current;
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
      const next={visible:true,opacity:0.4,label:mask.labels[0]?.id??null};
      callbacks.current.onImport(mask,next);
      setSummary({name:masks[0].name,labels:mask.labels,result});setDisplay(next);
    } catch(cause) {
      if (request===version.current) setError(cause instanceof Error?cause.message:String(cause));
    } finally {if (request===version.current) setBusy(false);}
  };
  const change = (next: MaskDisplay) => {
    try { callbacks.current.onDisplay(next);setDisplay(next);setError(""); }
    catch(cause) {setError(cause instanceof Error ? cause.message : String(cause));}
  };
  const selected = display.label===null ? null : summary?.labels.find(l=>l.id===display.label);
  const voxels = selected?.voxels ?? summary?.labels.reduce((n,l)=>n+l.voxels,0) ?? 0;
  const volumeMl = selected?.volumeMl ?? summary?.labels.reduce((n,l)=>n+l.volumeMl,0) ?? 0;

  return <section className="ora-mask-controls" aria-label="Готовая сегментационная маска">
    <div className="ora-mask-heading"><strong>Сегментация · готовая маска</strong><span>Локальный импорт</span></div>
    <p>Загрузите NIfTI-маску именно выбранной DICOM-серии. Проверяются размеры, положение и ориентация. Для открытой исследовательской КТ доступна опциональная локальная Lungmask R231 после отдельной установки.</p>
    <LocalLungmaskPanel ready={ready&&!busy&&!exportBusy} onBusy={setWorkerBusy}
      onPrepare={signal=>callbacks.current.onPrepareStream(signal)} onResult={(mask,result)=>{
        const next={visible:true,opacity:0.4,label:null};
        callbacks.current.onImport(mask,next);
        setSummary({name:"Lungmask R231 · локальный worker",labels:mask.labels,result});setDisplay(next);setError("");
      }}/>
    <div className="ora-mask-actions">
      <button type="button" disabled={!ready||busy||exportBusy||workerBusy} onClick={()=>input.current?.click()}>{busy ? "Проверка маски…" : summary ? "Заменить маску .nii / .nii.gz" : "Загрузить маску .nii / .nii.gz"}</button>
      {summary && <button type="button" disabled={exportBusy||workerBusy} onClick={()=>{
        version.current++; callbacks.current.onClear();setSummary(null);setBusy(false);setError("");
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
      {summary.result ? <details className="ora-mask-provenance">
        <summary>Суммы совпали · {summary.result.model.id} · сведения о модели</summary>
        <p>Заявленная модель: {summary.result.model.id} · {summary.result.model.version}. Задача: {summary.result.model.task}.</p>
        <small>Запрос: {summary.result.requestId}<br/>SHA-256 весов: {summary.result.model.weightsSha256}</small>
        {summary.result.limitations.length>0 && <ul>{summary.result.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul>}
        <small>Паспорт не подписан. Контрольные суммы не удостоверяют автора модели, клиническую точность или применимость к последовательности.</small>
      </details> : <p className="ora-mask-binding-note">Проверена только геометрия. Связь с пакетом серии и сведения о модели не проверены.</p>}
      {summary.labels.length ? <>
        <div className="ora-mask-settings">
          <label className="ora-mask-visible"><input type="checkbox" checked={display.visible} onChange={event=>change({...display,visible:event.target.checked})}/> Показать на MPR</label>
          <label>Метка<select value={display.label??"all"} onChange={event=>change({...display,label:event.target.value==="all" ? null : Number(event.target.value)})}>
            <option value="all">Все метки</option>
            {summary.labels.map(l=><option value={l.id} key={l.id}>Метка {l.id}{summary.result ? ` · ${summary.result.labels.find(item=>item.id===l.id)?.name}` : ""} · {l.voxels.toLocaleString("ru-RU")} вокселей</option>)}
          </select></label>
          <label>Непрозрачность: {Math.round(display.opacity*100)}%<input type="range" min="0" max="80" value={Math.round(display.opacity*100)} onChange={event=>change({...display,opacity:Number(event.target.value)/100})}/></label>
        </div>
        <p className="ora-mask-quantification">{selected && <i aria-hidden="true" style={{background:`rgb(${maskColor(selected.id).join(",")})`}}/>}{selected ? `Метка ${selected.id}` : "Все метки"}: {voxels.toLocaleString("ru-RU")} вокселей · объём разметки ≈ {volumeMl.toFixed(3)} мл.</p>
        <small>Объём рассчитан по меткам и геометрии маски; это не оценка точности модели. Названия из паспорта заявлены поставщиком результата. Маска отображается поверх MPR, без 3D-поверхностей.</small>
      </> : <p>Маска не содержит ненулевых меток. Это не подтверждает отсутствие патологических изменений.</p>}
    </>}
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
