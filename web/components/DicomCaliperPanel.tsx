"use client";
import {useEffect,useRef,useState} from "react";
import {measureDicomInPlaneCaliper,parseDicomFrame,renderDicomPixels,
 type DicomFrame,type DicomCaliperMeasurement} from "../lib/dicom-lite";
import type {TechnicalDicomMetadata} from "../lib/dicom-series";

type Point={x:number;y:number};
type Saved={sourceSopInstanceUid:string;sourceSeriesInstanceUid:string;
  measurement:DicomCaliperMeasurement};
type Props={file:File|null;metadata:TechnicalDicomMetadata|null;seriesKey:string|null};

export default function DicomCaliperPanel({file,metadata,seriesKey}:Props){
  const canvas=useRef<HTMLCanvasElement|null>(null);
  const frame=useRef<DicomFrame|null>(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState("");
  const [start,setStart]=useState<Point|null>(null);
  const [end,setEnd]=useState<Point|null>(null);
  const [saved,setSaved]=useState<Saved[]>([]);
  const [hint,setHint]=useState("");
  useEffect(()=>{setSaved([]);setHint("");},[seriesKey]);
  useEffect(()=>{
    let cancelled=false;frame.current=null;setReady(false);setStart(null);setEnd(null);setError("");
    if(!file||!metadata||!["CT","MR"].includes(metadata.modality))return;
    if(file.size>64*1024**2||file.size<160){
      setError("Слишком большой или неподдерживаемый DICOM для локальных измерений.");return;
    }
    void file.arrayBuffer().then(bytes=>{
      if(cancelled)return;
      const parsed=parseDicomFrame(bytes);
      if(parsed.metadata.modality!==metadata.modality||
         parsed.metadata.width!==metadata.columns||
         parsed.metadata.height!==metadata.rows)
        throw Error("Метаданные размера и модальности исходного среза не совпадают.");
      frame.current=parsed;setReady(true);
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Не удалось прочитать исходный срез.");});
    return ()=>{cancelled=true;frame.current=null;};
  },[file,metadata]);
  let current:DicomCaliperMeasurement|null=null,measureError="";
  if(start&&end&&metadata){
    try{current=measureDicomInPlaneCaliper(metadata,start,end);}
    catch(e){measureError=e instanceof Error?e.message:"Измерение недоступно.";}
  }
  useEffect(()=>{
    const f=frame.current,c=canvas.current;
    if(!ready||!f||!c)return;
    const context=c.getContext("2d");if(!context)return;
    c.width=f.metadata.width;c.height=f.metadata.height;
    const image=context.createImageData(c.width,c.height);
    image.data.set(renderDicomPixels(f));context.putImageData(image,0,0);
    if(start){
      context.strokeStyle="#facc15";context.fillStyle="#facc15";context.lineWidth=2;
      context.beginPath();context.arc(start.x,start.y,3,0,2*Math.PI);context.fill();
      if(end){
        context.beginPath();context.moveTo(start.x,start.y);context.lineTo(end.x,end.y);context.stroke();
        context.beginPath();context.arc(end.x,end.y,3,0,2*Math.PI);context.fill();
      }
    }
  },[ready,start,end]);
  const click=(e:React.MouseEvent<HTMLCanvasElement>)=>{
    const f=frame.current;if(!f)return;
    const rect=e.currentTarget.getBoundingClientRect();
    const point={
      x:Math.min(f.metadata.width-1,Math.max(0,Math.round((e.clientX-rect.left)/rect.width*f.metadata.width))),
      y:Math.min(f.metadata.height-1,Math.max(0,Math.round((e.clientY-rect.top)/rect.height*f.metadata.height))),
    };
    if(!start||end){setStart(point);setEnd(null);}
    else setEnd(point);
    setHint("");
  };
  const add=()=>{
    if(!current||!metadata?.seriesUid||!metadata.sopInstanceUid||saved.length>=16)return;
    setSaved(items=>[...items,{
      sourceSeriesInstanceUid:metadata.seriesUid!,sourceSopInstanceUid:metadata.sopInstanceUid!,
      measurement:current,
    }]);
    setHint("Длина добавлена к локальным измерениям.");
  };
  const save=()=>{
    if(!saved.length)return;
    const doc={
      schema:"opus-dicom-physician-manual-calipers/v1",modality:metadata?.modality,
      status:"manually_selected_unsigned_research_measurements",
      imagePlaneOnly:true,seriesKey,sourceUIDsLocallyRetained:true,
      measurements:saved,wholeLesionSizeVerified:false,clinicalDiagnosis:null,
      cloudTransfer:false,
    };
    const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:"application/json"}));
    try{
      const link=document.createElement("a");link.href=url;link.download="opus-dicom-calipers.json";
      document.body.appendChild(link);link.click();link.remove();
    }finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
    setHint("Измерения сохранены локально с UID исходных срезов.");
  };
  return <section className="ora-card" aria-label="Линейка на исходном срезе КТ или МРТ"
    style={{padding:18,marginTop:12}}>
    <h3 style={{margin:"0 0 8px"}}>КТ/МРТ · линейка в миллиметрах</h3>
    <p>Два клика по исходному срезу — расстояние в мм. Можно измерять размеры
      видимых образований и сохранять несколько линий с привязкой к срезу.</p>
    {!file||!["CT","MR"].includes(metadata?.modality??"")?
      <p role="status">Откройте КТ или МРТ-срез для измерения.</p>:
      <>
        {error&&<p role="alert">{error}</p>}
        {ready&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:16}}>
          <div>
            <canvas ref={canvas} onClick={click} role="img"
              aria-label="Нажмите первую и вторую точку расстояния на исходном DICOM-срезе"
              style={{width:"100%",maxWidth:512,height:"auto",border:"1px solid #64748b",
                background:"#000",cursor:"crosshair"}}/>
            <p><small>Жёлтая линия — измерение в плоскости исходного кадра.</small></p>
          </div>
          <div>
            {current?<div aria-live="polite">
              <p><strong style={{fontSize:"1.6rem"}}>{current.lengthMm.toFixed(2)} мм</strong></p>
              <p>Расстояние по столбцам: {Math.abs(current.deltaPixels.x*current.spacingMm[1]).toFixed(2)} мм;
                 по строкам: {Math.abs(current.deltaPixels.y*current.spacingMm[0]).toFixed(2)} мм.</p>
              <button type="button" disabled={saved.length>=16} onClick={add}>
                Сохранить измерение ({saved.length}/16)
              </button>
              <button type="button" onClick={()=>{setStart(null);setEnd(null);}}>Новая линия</button>
            </div>:
              <p role="status">{measureError||(!start?
                "Укажите первую точку на изображении.":"Укажите вторую точку для измерения.")}</p>}
          </div>
        </div>}
        {saved.length>0&&<div>
          <h4>Сохранённые измерения ({saved.length})</h4>
          <ol>{saved.map((s,i)=>
            <li key={i}>{s.measurement.lengthMm.toFixed(2)} мм · исходный срез
              <button type="button" onClick={()=>setSaved(rows=>rows.filter((_,j)=>j!==i))}>Удалить</button>
            </li>)}</ol>
          <button type="button" onClick={save}>Экспорт локальных размеров</button>
        </div>}
        {hint&&<p role="status">{hint}</p>}
        <p><small>Используется физический PixelSpacing исходного DICOM, а не масштаб окна.
          Измеряется только расстояние в плоскости кадра. Ориентация, контраст и
          пределы очага определяются врачом; это не автоматический детектор и
          не измерение полного объёма опухоли. Несжатые однокадровые CT/MR.</small></p>
      </>}
  </section>;
}
