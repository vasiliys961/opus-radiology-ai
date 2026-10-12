"use client";
import { useEffect,useRef,useState } from "react";
import { buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview,pngFromBase64,validatePrivacyRectangle,
  type PrivacyFrame,type PrivacyRectangle } from "../lib/vision-privacy";
import { redactPrivacyFrame } from "../lib/vision-privacy-browser";

/** No network, persistence, medical model or free-text export. Original source stays local. */
export default function VisionPrivacyPreparation({previews,modality}:{previews:readonly (string|undefined)[];modality:string}) {
  const [frames,setFrames]=useState<PrivacyFrame[]>([]),[selected,setSelected]=useState(0);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [rectangle,setRectangle]=useState<PrivacyRectangle>({x:0,y:0,width:1,height:1});
  const generation=useRef(0);
  useEffect(()=>()=>{++generation.current;},[]);
  const frame=frames[selected];
  let validRectangle=false;try{if(frame){validatePrivacyRectangle(rectangle,frame.width,frame.height);validRectangle=true;}}catch{}
  const reviewed=frames.length>0&&frames.every(f=>f.pixelReviewSha256===f.sha256&&f.visualReviewSha256===f.sha256);
  const prepare=()=>{
    ++generation.current;setError("");
    try{
      if(!["CT","MR"].includes(modality)||!previews.length||previews.length>4||previews.some(p=>!p?.startsWith("data:image/png;base64,")))
        throw new Error("Сначала дождитесь локальных PNG-миниатюр всех выбранных срезов.");
      const next=previews.map((url,i)=>createPrivacyFrame(pngFromBase64(url!.split(",")[1]),`frame-${i+1}`,modality as "CT"|"MR"));
      setFrames(next);setSelected(0);setRectangle({x:0,y:0,width:1,height:1});
    }catch(e){setError(e instanceof Error?e.message:"Не удалось подготовить копии.");}
  };
  const redact=async()=>{
    if(!frame)return;const version=++generation.current;setBusy(true);setError("");
    try{
      const next=await redactPrivacyFrame(frame,rectangle);if(version!==generation.current)return;
      setFrames(previous=>previous.map(f=>f.frameId===next.frameId?next:f));
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Не удалось скрыть область.");}
    finally{if(version===generation.current)setBusy(false);}
  };
  const review=(kind:"pixel"|"visual",checked:boolean)=>{
    if(!frame)return;setFrames(previous=>previous.map(f=>f.frameId===frame.frameId?markPrivacyReview(f,kind,checked):f));
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
      <label>Копия кадра <select value={selected} disabled={busy} onChange={e=>{setSelected(Number(e.target.value));setError("");}}>
        {frames.map((f,i)=><option key={f.frameId} value={i}>Кадр {i+1} · {f.width}×{f.height}</option>)}
      </select></label>
      <p>Просмотр 1:1. Если кадр больше области просмотра, прокрутите его и проверьте все края.</p>
      <div className="ora-privacy-preview-scroll"><img className="ora-privacy-preview" width={frame.width} height={frame.height}
        src={"data:image/png;base64,"+frame.pngBase64} alt="Точная подготовленная копия кадра"/></div>
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
