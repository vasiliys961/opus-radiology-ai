"use client";
import { useEffect,useRef,useState } from "react";
import { buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview,pngFromBase64,validatePrivacyRectangle,
  type PrivacyFrame,type PrivacyRectangle } from "../lib/vision-privacy";
import { redactPrivacyRegions } from "../lib/vision-privacy-browser";
import { scanPrivacyText,type PrivacyOcrResult } from "../lib/privacy-ocr";

/** OCR reads same-origin fixed assets only. No image upload or recognized-text export. */
export default function VisionPrivacyPreparation({previews,modality}:{previews:readonly (string|undefined)[];modality:string}) {
  const [frames,setFrames]=useState<PrivacyFrame[]>([]),[selected,setSelected]=useState(0);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [rectangle,setRectangle]=useState<PrivacyRectangle>({x:0,y:0,width:1,height:1});
  const [ocr,setOcr]=useState<Record<string,PrivacyOcrResult>>({}),[ocrBusy,setOcrBusy]=useState(false),[ocrNotice,setOcrNotice]=useState("");
  const [keptText,setKeptText]=useState<Record<string,string>>({});
  const scan=useRef<AbortController|null>(null);
  const generation=useRef(0);
  useEffect(()=>()=>{++generation.current;scan.current?.abort();},[]);
  const frame=frames[selected];
  const currentOcr=frame&&ocr[frame.frameId]?.sha256===frame.sha256?ocr[frame.frameId]:undefined;
  const unresolvedText=!!currentOcr?.regions.length&&keptText[frame.frameId]!==frame.sha256;
  let validRectangle=false;try{if(frame){validatePrivacyRectangle(rectangle,frame.width,frame.height);validRectangle=true;}}catch{}
  const reviewed=frames.length>0&&frames.every(f=>f.pixelReviewSha256===f.sha256&&f.visualReviewSha256===f.sha256);
  const prepare=()=>{
    ++generation.current;setError("");
    try{
      if(!["CT","MR"].includes(modality)||!previews.length||previews.length>4||previews.some(p=>!p?.startsWith("data:image/png;base64,")))
        throw new Error("Сначала дождитесь локальных PNG-миниатюр всех выбранных срезов.");
      const next=previews.map((url,i)=>createPrivacyFrame(pngFromBase64(url!.split(",")[1]),`frame-${i+1}`,modality as "CT"|"MR"));
      setFrames(next);setSelected(0);setRectangle({x:0,y:0,width:1,height:1});setOcr({});setKeptText({});setOcrNotice("");
    }catch(e){setError(e instanceof Error?e.message:"Не удалось подготовить копии.");}
  };
  const redact=async(regions:PrivacyRectangle[]=[rectangle])=>{
    if(!frame)return;const version=++generation.current;setBusy(true);setError("");
    try{
      const next=await redactPrivacyRegions(frame,regions);if(version!==generation.current)return;
      setFrames(previous=>previous.map(f=>f.frameId===next.frameId?next:f));
      setOcrNotice("Копия изменена. Повторите поиск надписей и ручную проверку.");
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Не удалось скрыть область.");}
    finally{if(version===generation.current)setBusy(false);}
  };
  const findText=async()=>{
    if(!frame)return;const controller=new AbortController(),version=++generation.current;scan.current=controller;
    setBusy(true);setOcrBusy(true);setError("");setOcrNotice("Локальный поиск надписей · до 30 секунд…");
    setFrames(previous=>previous.map(f=>f.frameId===frame.frameId?{...f,pixelReviewSha256:null,visualReviewSha256:null}:f));
    setOcr(previous=>{const next={...previous};delete next[frame.frameId];return next;});
    setKeptText(previous=>{const next={...previous};delete next[frame.frameId];return next;});
    try{
      const result=await scanPrivacyText(frame,controller.signal);if(version!==generation.current)return;
      if(controller.signal.aborted)throw new DOMException("OCR отменён.","AbortError");
      setOcr(previous=>({...previous,[frame.frameId]:result}));setOcrNotice("");
    }catch(e){if(version===generation.current){
      if(controller.signal.aborted)setOcrNotice("OCR отменён. Автоматическая проверка не выполнена.");
      else {setOcrNotice("");setError(e instanceof Error?e.message:"OCR не завершён.");}
    }}finally{if(version===generation.current){scan.current=null;setBusy(false);setOcrBusy(false);}}
  };
  const review=(kind:"pixel"|"visual",checked:boolean)=>{
    if(!frame)return;
    if(checked&&unresolvedText){setError("Сначала скройте найденные надписи или отметьте их как неидентифицирующие после просмотра.");return;}
    setFrames(previous=>previous.map(f=>f.frameId===frame.frameId?markPrivacyReview(f,kind,checked):f));
  };
  const download=()=>{
    try{
      const packet=buildVisionPrivacyPacket(frames,crypto.randomUUID());
      const url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:"application/json"}));
      const a=document.createElement("a");a.href=url;a.download="opus-local-privacy-candidate.json";
      a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить пакет.");}
  };
  return <section className="ora-privacy-preparation" aria-label="Подготовка обезличенных кадров">
    <h3>Подготовка к облаку · локальные копии</h3>
    <p>В копии остаются только PNG-пиксели выбранных срезов: без DICOM-тегов, исходных UID, имён файлов и клинического текста. Надписи внутри изображения нужно удалить отдельно.</p>
    <button type="button" disabled={busy||previews.some(p=>!p)} onClick={prepare}>{frames.length?"Создать копии заново":"Подготовить копии без метаданных"}</button>
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
            <button type="button" disabled={busy} onClick={()=>{setKeptText(previous=>({...previous,[frame.frameId]:frame.sha256}));setError("");
              setOcrNotice("");}}>Оставить надписи: не идентифицируют пациента</button>
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
      <button type="button" disabled={busy||!reviewed} onClick={download}>Скачать локальный пакет копий JSON</button>
    </>}
    <p>Это ручная локальная проверка, не автоматическое подтверждение обезличивания. Пакет может содержать чувствительные пиксели; храните локально. Отправка ещё недоступна: серверная проверка защиты и авторизованный cloud-контур не подключены.</p>
  </section>;
}
