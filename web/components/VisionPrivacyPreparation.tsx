"use client";
import { useEffect,useRef,useState } from "react";
import { buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview,pngFromBase64,validatePrivacyRectangle,
  type PrivacyFrame,type PrivacyRectangle } from "../lib/vision-privacy";
import { redactPrivacyRegions,validatePrivacyRaster } from "../lib/vision-privacy-browser";
import { scanPrivacyText,type PrivacyOcrResult } from "../lib/privacy-ocr";
import { appendPrivacyEvent,buildPrivacyReviewBundle,createPrivacyJournal,exportPrivacyJournal,MAX_PRIVACY_EVENTS,
  MAX_PRIVACY_BUNDLE_BYTES,restorePrivacyReviewBundle,type PrivacyAction,type PrivacyJournal } from "../lib/privacy-review-journal";
import { acquireBrowserCompute } from "../lib/browser-compute-slot";
import VisionPrivacyReadiness from "./VisionPrivacyReadiness";
import DeidentifiedOpenRouterPanel from "./DeidentifiedOpenRouterPanel";
import type {LocalLungFacts} from "../lib/local-lung-review";
import { buildPrivacyReadinessReport } from "../lib/privacy-readiness";

const actionLabels:Record<PrivacyAction["kind"],string>={redacted:"Скрытие областей", "ocr-started":"OCR начат",
  "ocr-completed":"OCR завершён","ocr-cancelled":"OCR отменён","ocr-failed":"OCR не завершён",
  "text-retained":"Надписи оставлены по ручной отметке","review-set":"Ручная проверка","copy-restored":"Копия восстановлена · проверки сняты"};

/** OCR reads same-origin fixed assets only. No image upload or recognized-text export. */
export default function VisionPrivacyPreparation({previews,modality,originalLocalFileIds,onOpenOriginalSlice,specialistFacts}:{
  previews:readonly (string|undefined)[];modality:string;
  originalLocalFileIds:readonly string[];
  onOpenOriginalSlice:(localFileId:string)=>void;
  specialistFacts?:LocalLungFacts|null;
}) {
  const [frames,setFrames]=useState<PrivacyFrame[]>([]),[selected,setSelected]=useState(0);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [rectangle,setRectangle]=useState<PrivacyRectangle>({x:0,y:0,width:1,height:1});
  const [ocr,setOcr]=useState<Record<string,PrivacyOcrResult>>({}),[ocrBusy,setOcrBusy]=useState(false),[ocrNotice,setOcrNotice]=useState("");
  const [keptText,setKeptText]=useState<Record<string,string>>({});
  const [journal,setJournal]=useState<PrivacyJournal|null>(null);
  const [importBusy,setImportBusy]=useState(false),[importNotice,setImportNotice]=useState("");
  const journalRef=useRef<PrivacyJournal|null>(null);
  const scan=useRef<AbortController|null>(null);
  const generation=useRef(0);
  useEffect(()=>()=>{++generation.current;scan.current?.abort();},[]);
  const frame=frames[selected];
  const currentOcr=frame&&ocr[frame.frameId]?.sha256===frame.sha256?ocr[frame.frameId]:undefined;
  const unresolvedText=!!currentOcr?.regions.length&&keptText[frame.frameId]!==frame.sha256;
  let validRectangle=false;try{if(frame){validatePrivacyRectangle(rectangle,frame.width,frame.height);validRectangle=true;}}catch{}
  const reviewed=frames.length>0&&frames.every(f=>f.pixelReviewSha256===f.sha256&&f.visualReviewSha256===f.sha256);
  const allOcrChecked=frames.length>0&&frames.every(f=>{
    const output=ocr[f.frameId];
    return !!output&&output.sha256===f.sha256&&
      (output.regions.length===0||keptText[f.frameId]===f.sha256);
  });
  const pilotReady=reviewed&&allOcrChecked&&!busy&&!ocrBusy&&!importBusy;
  const makePilotPacket=()=>{
    if(!pilotReady||!journalRef.current)throw new Error("Повторите проверку всех точных копий.");
    const packet=buildVisionPrivacyPacket(frames,crypto.randomUUID());
    // Source frame IDs and action SHA remain local; never send this journal.
    exportPrivacyJournal(journalRef.current,packet.frames);
    return packet;
  };
  const record=(target:PrivacyFrame,action:PrivacyAction)=>{
    if(!journalRef.current)throw new Error("Сначала создайте копии и локальный журнал.");
    const next=appendPrivacyEvent(journalRef.current,target.frameId,target.sha256,action,new Date().toISOString());
    journalRef.current=next;setJournal(next);
  };
  const initialCopies=()=>{
    if(!["CT","MR"].includes(modality)||!previews.length||previews.length>4||previews.some(p=>!p?.startsWith("data:image/png;base64,")))
      throw new Error("Сначала дождитесь локальных PNG-миниатюр всех выбранных срезов.");
    return previews.map((url,i)=>createPrivacyFrame(pngFromBase64(url!.split(",")[1]),`frame-${i+1}`,modality as "CT"|"MR"));
  };
  const prepare=()=>{
    ++generation.current;setError("");setImportNotice("");
    try{
      const next=initialCopies();
      const nextJournal=createPrivacyJournal(next,crypto.randomUUID(),new Date().toISOString());
      journalRef.current=nextJournal;setJournal(nextJournal);
      setFrames(next);setSelected(0);setRectangle({x:0,y:0,width:1,height:1});setOcr({});setKeptText({});setOcrNotice("");
    }catch(e){setError(e instanceof Error?e.message:"Не удалось подготовить копии.");}
  };
  const restore=async(file:File)=>{
    const controller=new AbortController(),version=++generation.current;scan.current=controller;
    setBusy(true);setImportBusy(true);setError("");setImportNotice("");let release:(()=>void)|undefined;
    try{
      if(!file.size||file.size>MAX_PRIVACY_BUNDLE_BYTES)throw new Error("Выберите пакет копий с журналом не более 12 МиБ.");
      release=acquireBrowserCompute("privacy-restore");
      const text=await file.text();if(controller.signal.aborted)throw new DOMException("Восстановление отменено.","AbortError");
      const next=restorePrivacyReviewBundle(text,initialCopies(),journalRef.current?{journal:journalRef.current,frames}:null,new Date().toISOString());
      for(const f of next.frames)await validatePrivacyRaster(f,controller.signal);
      if(version!==generation.current||controller.signal.aborted)return;
      journalRef.current=next.journal;setJournal(next.journal);setFrames(next.frames);setSelected(0);
      setOcr({});setKeptText({});setOcrNotice("");setRectangle({x:0,y:0,width:1,height:1});
      setImportNotice("Копии и история восстановлены. Осмотрите каждый кадр заново: ручные проверки и результат OCR не перенесены.");
    }catch(e){if(version===generation.current)setError(controller.signal.aborted?"Восстановление отменено. Текущая работа сохранена.":
      e instanceof Error?e.message:"Не удалось восстановить пакет. Текущая работа сохранена.");}
    finally{release?.();if(version===generation.current){scan.current=null;setBusy(false);setImportBusy(false);}}
  };
  const redact=async(regions:PrivacyRectangle[]=[rectangle])=>{
    if(!frame)return;const version=++generation.current;setBusy(true);setError("");
    try{
      const next=await redactPrivacyRegions(frame,regions);if(version!==generation.current)return;
      record(frame,{kind:"redacted",nextSha256:next.sha256,rectangles:regions});
      setFrames(previous=>previous.map(f=>f.frameId===next.frameId?next:f));
      setOcrNotice("Копия изменена. Повторите поиск надписей и ручную проверку.");
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Не удалось скрыть область.");}
    finally{if(version===generation.current)setBusy(false);}
  };
  const findText=async()=>{
    if(!frame)return;
    try{record(frame,{kind:"ocr-started"});}catch(e){setError(e instanceof Error?e.message:"Не удалось записать действие.");return;}
    const controller=new AbortController(),version=++generation.current;scan.current=controller;
    setBusy(true);setOcrBusy(true);setError("");setOcrNotice("Локальный поиск надписей · до 30 секунд…");
    setFrames(previous=>previous.map(f=>f.frameId===frame.frameId?{...f,pixelReviewSha256:null,visualReviewSha256:null}:f));
    setOcr(previous=>{const next={...previous};delete next[frame.frameId];return next;});
    setKeptText(previous=>{const next={...previous};delete next[frame.frameId];return next;});
    try{
      const result=await scanPrivacyText(frame,controller.signal);if(version!==generation.current)return;
      if(controller.signal.aborted)throw new DOMException("OCR отменён.","AbortError");
      record(frame,{kind:"ocr-completed",regionCount:result.regions.length});
      setOcr(previous=>({...previous,[frame.frameId]:result}));setOcrNotice("");
    }catch(e){if(version===generation.current){
      record(frame,{kind:controller.signal.aborted?"ocr-cancelled":"ocr-failed"});
      if(controller.signal.aborted)setOcrNotice("OCR отменён. Автоматическая проверка не выполнена.");
      else {setOcrNotice("");setError(e instanceof Error?e.message:"OCR не завершён.");}
    }}finally{if(version===generation.current){scan.current=null;setBusy(false);setOcrBusy(false);}}
  };
  const review=(kind:"pixel"|"visual",checked:boolean)=>{
    if(!frame)return;
    if(checked&&unresolvedText){setError("Сначала скройте найденные надписи или отметьте их как неидентифицирующие после просмотра.");return;}
    try{
      record(frame,{kind:"review-set",review:kind,checked});
      setFrames(previous=>previous.map(f=>f.frameId===frame.frameId?markPrivacyReview(f,kind,checked):f));setError("");
    }catch(e){setError(e instanceof Error?e.message:"Не удалось записать проверку.");}
  };
  const retainText=()=>{
    if(!frame)return;
    try{record(frame,{kind:"text-retained"});setKeptText(previous=>({...previous,[frame.frameId]:frame.sha256}));setError("");setOcrNotice("");}
    catch(e){setError(e instanceof Error?e.message:"Не удалось записать отметку.");}
  };
  const download=(kind:"candidate"|"journal"|"bundle"|"readiness"="candidate")=>{
    try{
      if(!journalRef.current)throw new Error("Сначала создайте копии.");
      let packet:unknown;
      if(kind==="readiness")packet=buildPrivacyReadinessReport({frames,ocr,keptText,busy},journalRef.current);
      else if(kind==="journal")packet=exportPrivacyJournal(journalRef.current,frames);
      else if(kind==="bundle")packet=buildPrivacyReviewBundle(frames,journalRef.current,crypto.randomUUID());
      else{
        const candidate=buildVisionPrivacyPacket(frames,crypto.randomUUID());
        // Even the legacy candidate export must match the recorded actions.
        exportPrivacyJournal(journalRef.current,candidate.frames);packet=candidate;
      }
      const url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:"application/json"}));
      const a=document.createElement("a");a.href=url;a.download=`opus-local-privacy-${kind}.json`;
      a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить пакет.");}
  };
  return <section className="ora-privacy-preparation" aria-label="Подготовка обезличенных кадров">
    <h3>Подготовка к облаку · локальные копии</h3>
    <p>В копии остаются только PNG-пиксели выбранных срезов: без DICOM-тегов, исходных UID, имён файлов и клинического текста. Надписи внутри изображения нужно удалить отдельно.</p>
    <button type="button" disabled={busy||previews.some(p=>!p)} onClick={prepare}>{frames.length?"Создать копии заново":"Подготовить копии без метаданных"}</button>
    <label>Восстановить копии с журналом JSON <input type="file" accept=".json,application/json" disabled={busy||previews.some(p=>!p)}
      onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void restore(file);}}/></label>
    {importBusy&&<button type="button" onClick={()=>scan.current?.abort()}>Отменить восстановление</button>}
    {importNotice&&<p role="status">{importNotice}</p>}
    {error&&<p role="alert">{error}</p>}
    {frame&&<>
      <label>Копия кадра <select value={selected} disabled={busy} onChange={e=>{setSelected(Number(e.target.value));setError("");setOcrNotice("");}}>
        {frames.map((f,i)=><option key={f.frameId} value={i}>Кадр {i+1} · {f.width}×{f.height}</option>)}
      </select></label>
      <p>Просмотр 1:1. Если кадр больше области просмотра, прокрутите его и проверьте все края.</p>
      <div className="ora-privacy-preview-scroll"><div className="ora-privacy-image-region"><img className="ora-privacy-preview" width={frame.width} height={frame.height}
        src={"data:image/png;base64,"+frame.pngBase64} alt="Точная подготовленная копия кадра"/>
        {validRectangle&&<svg className="ora-privacy-selection" width={frame.width} height={frame.height} aria-label="Выделенная область скрытия">
          <rect x={rectangle.x} y={rectangle.y} width={rectangle.width} height={rectangle.height} fill="none" stroke="#f4aa36" strokeWidth={2}/></svg>}
      </div></div>
      <section className="ora-privacy-ocr" aria-label="Локальный поиск надписей">
        <button type="button" disabled={busy} onClick={()=>void findText()}>Найти надписи локально</button>
        {ocrBusy&&<button type="button" onClick={()=>scan.current?.abort()}>Отменить OCR</button>}
        {ocrNotice&&<p role="status">{ocrNotice}</p>}
        {currentOcr&&<>
          <p role="status">Областей с надписями: {currentOcr.regions.length}. OCR может пропустить текст; ручная проверка обязательна.</p>
          {currentOcr.regions.length>0&&!unresolvedText&&<p>Найденные надписи оставлены как неидентифицирующие по вашей локальной отметке.</p>}
          <ul>{currentOcr.regions.map((r,i)=><li key={i}>Область {i+1}: {r.rectangle.x}, {r.rectangle.y} · {r.rectangle.width}×{r.rectangle.height}
            <button type="button" disabled={busy} onClick={()=>setRectangle(r.rectangle)}>Выбрать область {i+1}</button></li>)}</ul>
          {currentOcr.regions.length>0&&<>
            <button type="button" disabled={busy||frame.redactions.length+currentOcr.regions.length>32}
              onClick={()=>void redact(currentOcr.regions.map(r=>r.rectangle))}>Скрыть найденные надписи</button>
            <button type="button" disabled={busy||!unresolvedText} onClick={retainText}>Оставить надписи: не идентифицируют пациента</button>
          </>}
        </>}
        <p>Поиск на русском и английском выполняется в браузере на одном кадре. Ресурсы OCR загружаются с этого приложения, пиксели на сервер не отправляются. OCR не проверяет лицо и не подтверждает обезличивание.</p>
      </section>
      <p>Область скрытия в пикселях: отсчёт от левого верхнего угла. Оригинал не меняется; скрытые области теряют диагностическое содержимое.</p>
      <div className="ora-privacy-rectangle">{(["x","y","width","height"] as const).map((field,i)=><label key={field}>{["X","Y","Ширина","Высота"][i]}
        <input type="number" min={field==="x"||field==="y"?0:1} step={1} value={Number.isFinite(rectangle[field])?rectangle[field]:""} disabled={busy}
          onChange={e=>setRectangle(previous=>({...previous,[field]:e.target.value===""?NaN:Number(e.target.value)}))}/></label>)}</div>
      <button type="button" disabled={busy||!validRectangle||frame.redactions.length>=32} onClick={()=>void redact()}>Скрыть область в копии</button>
      <p role="status">Скрытых областей: {frame.redactions.length}. Изменение копии сбрасывает её проверку.</p>
      <label><input type="checkbox" disabled={busy} checked={frame.pixelReviewSha256===frame.sha256} onChange={e=>review("pixel",e.target.checked)}/> Проверил копию: идентифицирующих надписей нет</label>
      <label><input type="checkbox" disabled={busy} checked={frame.visualReviewSha256===frame.sha256} onChange={e=>review("visual",e.target.checked)}/> Проверил копию: лица и узнаваемых признаков нет</label>
      <VisionPrivacyReadiness frames={frames} ocr={ocr} keptText={keptText} busy={busy}/>
      <button type="button" disabled={busy} onClick={()=>download("readiness")}>Скачать локальный статус без пикселей JSON</button>
      <button type="button" disabled={busy||!reviewed} onClick={()=>download()}>Скачать локальный пакет копий JSON</button>
      {journal&&<section aria-label="Локальный журнал приватности">
        <p role="status">Действий в журнале: {journal.events.length} из {MAX_PRIVACY_EVENTS}. Время и проверяющий не подтверждены.</p>
        <details><summary>История действий</summary><ol>{journal.events.map(e=><li key={e.revision}>
          {e.revision}. Кадр {e.frameId.slice(-1)} · {actionLabels[e.action.kind]} · {e.declaredAt}
          {e.action.kind==="ocr-completed"&&` · областей: ${e.action.regionCount}`}
          {e.action.kind==="redacted"&&` · областей: ${e.action.rectangles.length}`}
          {e.action.kind==="review-set"&&` · ${e.action.review==="pixel"?"надписи":"узнаваемые признаки"}: ${e.action.checked?"отметка поставлена":"отметка снята"}`}
        </li>)}</ol></details>
        <button type="button" disabled={busy} onClick={()=>download("journal")}>Скачать журнал без пикселей JSON</button>
        <button type="button" disabled={busy||!reviewed} onClick={()=>download("bundle")}>Скачать копии с журналом JSON</button>
        <p>Сохранение только по вашей команде. Новый набор копий заменит текущий журнал и проверки; сохраните нужный файл заранее. Журнал содержит привязки SHA, но не слова OCR и не оригинальные UID. Пакет с копиями содержит чувствительные пиксели. Это локальные неподписанные записи, не разрешение на облачную передачу.</p>
      </section>}
    </>}
    {frames.length>0&&<DeidentifiedOpenRouterPanel
      key={frames.map(f=>f.sha256).join(":")}
      enabledByLocalChecks={pilotReady}
      exactReviewedHashes={frames.map(f=>({imageId:f.frameId,sha256:f.sha256}))}
      prepareReviewedPacket={makePilotPacket}
      originalLocalFileIds={originalLocalFileIds}
      specialistFacts={specialistFacts}
      onOpenOriginalSlice={onOpenOriginalSlice}
    />}
    <p>Ручная проверка и OCR не удостоверяют полную анонимизацию. Работа с
      медицинскими данными и передача в OpenRouter допустимы только при
      подтверждённых правах и настройках локального исследовательского сервера.
      Основной клинический cloud-доступ по-прежнему закрыт.</p>
  </section>;
}
