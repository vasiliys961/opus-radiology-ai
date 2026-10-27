"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {measureCtDicomCircularRoi,parseDicomFrame,renderDicomPixels,
  type CtRoiMeasurement,type DicomFrame} from "../lib/dicom-lite";
import type {TechnicalDicomMetadata} from "../lib/dicom-series";

type Label="liver"|"spleen"|"l1-trabecular"|"other";
const labels:Record<Label,string>={
 liver:"Печень (отметка врача)",
 spleen:"Селезёнка (отметка врача)",
 "l1-trabecular":"L1 · трабекулярная ткань (отметка врача)",
 other:"Другой участок (отметка врача)",
};
type Saved={
 label:Label;sourceSeriesUid:string;sourceSopUid:string;
 roi:CtRoiMeasurement;
};
type Props={file:File|null;metadata:TechnicalDicomMetadata|null;seriesKey:string|null};

export default function CtHuRoiPanel({file,metadata,seriesKey}:Props){
 const canvas=useRef<HTMLCanvasElement|null>(null);
 const frame=useRef<DicomFrame|null>(null);
 const [loaded,setLoaded]=useState(false);
 const [error,setError]=useState("");
 const [location,setLocation]=useState<{x:number;y:number}|null>(null);
 const [radius,setRadius]=useState(8);
 const [label,setLabel]=useState<Label>("other");
 const [saved,setSaved]=useState<Saved[]>([]);
 const [note,setNote]=useState("");
 useEffect(()=>{setSaved([]);setNote("");},[seriesKey]);
 useEffect(()=>{
   let cancelled=false;
   frame.current=null;setLoaded(false);setError("");setLocation(null);
   if(!file||!metadata||metadata.modality!=="CT")return;
   if(file.size<200||file.size>64*1024**2){
     setError("Размер DICOM не поддерживается локальным ROI-инструментом.");
     return;
   }
   void file.arrayBuffer().then(buffer=>{
     if(cancelled)return;
     const next=parseDicomFrame(buffer);
     if(next.metadata.modality!=="CT")throw Error("ROI доступен только для КТ.");
     frame.current=next;setLoaded(true);
   }).catch(e=>{
     if(!cancelled)setError(e instanceof Error?e.message:"Не удалось декодировать исходный CT");
   });
   return ()=>{cancelled=true;frame.current=null;};
 },[file,metadata]);
 const measurement=useMemo(()=>{
   if(!loaded||!frame.current||!metadata||!location)return null;
   try{return measureCtDicomCircularRoi(
     frame.current,metadata,location.x,location.y,radius);
   }catch{return null;}
 },[loaded,metadata,location,radius]);
 const roiError=useMemo(()=>{
   if(!loaded||!frame.current||!metadata||!location||measurement)return "";
   try{measureCtDicomCircularRoi(frame.current,metadata,location.x,location.y,radius);}
   catch(e){return e instanceof Error?e.message:"Измерение недоступно";}
   return "";
 },[loaded,metadata,location,radius,measurement]);
 useEffect(()=>{
   if(!loaded||!frame.current||!canvas.current)return;
   const f=frame.current,element=canvas.current,ctx=element.getContext("2d");
   if(!ctx)return;
   element.width=f.metadata.width;element.height=f.metadata.height;
   const bitmap=ctx.createImageData(element.width,element.height);
   bitmap.data.set(renderDicomPixels(f));ctx.putImageData(bitmap,0,0);
   if(location){
     ctx.beginPath();ctx.arc(location.x,location.y,radius,0,Math.PI*2);
     ctx.strokeStyle="#facc15";ctx.lineWidth=2;ctx.stroke();
     ctx.beginPath();ctx.moveTo(location.x-5,location.y);ctx.lineTo(location.x+5,location.y);
     ctx.moveTo(location.x,location.y-5);ctx.lineTo(location.x,location.y+5);
     ctx.stroke();
   }
 },[loaded,location,radius]);
 const pick=(e:React.MouseEvent<HTMLCanvasElement>)=>{
   const f=frame.current;if(!f)return;
   const box=e.currentTarget.getBoundingClientRect();
   const x=(e.clientX-box.left)/box.width*f.metadata.width;
   const y=(e.clientY-box.top)/box.height*f.metadata.height;
   setLocation({x:Math.round(x),y:Math.round(y)});setNote("");
 };
 const add=()=>{
   if(!measurement||!metadata?.seriesUid||!metadata.sopInstanceUid||saved.length>=16)return;
   setSaved(prev=>[...prev,{
     label,sourceSeriesUid:metadata.seriesUid!,sourceSopUid:metadata.sopInstanceUid!,
     roi:measurement,
   }]);
   setNote("ROI добавлен к локальным измерениям.");
 };
 const liver=saved.filter(m=>m.label==="liver");
 const spleen=saved.filter(m=>m.label==="spleen");
 const average=(items:Saved[])=>items.reduce((sum,v)=>sum+v.roi.meanHu,0)/items.length;
 const difference=liver.length&&spleen.length?
   Math.round((average(liver)-average(spleen))*100)/100:null;
 const exportJson=()=>{
   if(!saved.length)return;
   const report={
     schema:"opus-ct-manual-original-hu-rois/v1",modality:"CT",
     status:"physician_selected_measurement_not_diagnosis",
     sourceSeriesKey:seriesKey,sourceIdsLocallyRetained:true,
     measures:saved,meanLiverMinusSpleenHu:difference,
     contrastPhaseUnverified:true,ctCalibrationPhantomUnverified:true,
     steatosisDiagnosis:null,osteoporosisDiagnosis:null,cloudSent:false,
   };
   const blob=new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
   const url=URL.createObjectURL(blob);
   try{
     const a=document.createElement("a");a.href=url;
     a.download="opus-ct-original-hu-rois.json";
     document.body.appendChild(a);a.click();a.remove();
   }finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
   setNote("Локальный отчёт сохранён. Содержит UID срезов: храните его конфиденциально.");
 };
 return <section className="ora-card" aria-label="Локальная КТ-денситометрия ROI"
   style={{padding:18,marginTop:12}}>
   <h3 style={{margin:"0 0 8px"}}>КТ · измерение плотности тканей (HU)</h3>
   <p>Выберите участок непосредственно на исходном КТ-срезе. Измеряются реальные пиксели DICOM,
     а не прогноз нейросети. Можно сохранить несколько ROI печени, селезёнки или тела L1.</p>
   {!file||metadata?.modality!=="CT"?
     <p role="status">Откройте КТ-срез, чтобы измерить плотность тканей.</p>:
     <>
       {error&&<p role="alert">{error}</p>}
       {loaded&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:18}}>
         <div>
           <canvas ref={canvas} onClick={pick} role="img"
             aria-label="Исходный КТ-срез, нажмите в центре области измерения"
             style={{width:"100%",maxWidth:512,height:"auto",cursor:"crosshair",border:"1px solid #64748b",background:"#000"}} />
           <p><small>Жёлтый круг — выбранная врачом область. Все вычисления локальны.</small></p>
           <label>Радиус ROI: {radius} пикс.
             <input type="range" min={2} max={32} value={radius}
               onChange={e=>setRadius(Number(e.target.value))}
               style={{display:"block",width:"100%"}}/>
           </label>
           <label>Анатомическая область (выбирает врач)
             <select value={label} onChange={e=>setLabel(e.target.value as Label)}
               style={{display:"block",width:"100%"}}>
               {(Object.keys(labels) as Label[]).map(key=>
                 <option key={key} value={key}>{labels[key]}</option>)}
             </select>
           </label>
         </div>
         <div>
           {measurement?<div aria-live="polite">
             <p>Измерено <strong>{measurement.pixelCount}</strong> пикселей,
               площадь <strong>{measurement.areaMm2.toFixed(2)} мм²</strong>.</p>
             <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10}}>
               {([
                 ["Средняя плотность",measurement.meanHu],
                 ["Медиана",measurement.medianHu],
                 ["SD",measurement.stdDevHu],
                 ["P10",measurement.p10Hu],
                 ["P90",measurement.p90Hu],
                 ["Минимум",measurement.minHu],
                 ["Максимум",measurement.maxHu],
               ] as const).map(([title,value])=>
                 <div key={title}><small>{title}</small><div><strong>{value.toFixed(2)} HU</strong></div></div>)}
             </div>
             <p>Распределение HU в ROI</p>
             <div style={{display:"flex",gap:2,height:65,alignItems:"end"}}
               role="img" aria-label="Гистограмма плотностей внутри ROI">
               {measurement.histogram.map((bin,i)=>
                 <div key={i} title={`${bin.lowHu}–${bin.highHu} HU: ${bin.count}`}
                   style={{flex:1,height:`${Math.max(1,100*bin.count/Math.max(...measurement.histogram.map(b=>b.count)))}%`,
                     background:"#64748b"}}/>)}
             </div>
             <button type="button" onClick={add} disabled={saved.length>=16}>
               Сохранить этот ROI ({saved.length}/16)
             </button>
           </div>:<p role="status">{roiError||"Нажмите на КТ-срез, чтобы выбрать область измерения."}</p>}
         </div>
       </div>}
       {saved.length>0&&<div style={{marginTop:14}}>
         <h4>Сохранённые области · {saved.length}</h4>
         <div style={{overflowX:"auto"}}>
           <table style={{width:"100%",textAlign:"left"}}>
             <thead><tr><th>Выбранная область</th><th>Среднее HU</th><th>Медиана HU</th><th>SD HU</th><th>Управление</th></tr></thead>
             <tbody>{saved.map((m,i)=>
               <tr key={i}><td>{labels[m.label]}</td><td>{m.roi.meanHu.toFixed(2)}</td>
                 <td>{m.roi.medianHu.toFixed(2)}</td><td>{m.roi.stdDevHu.toFixed(2)}</td>
                 <td><button type="button" onClick={()=>setSaved(items=>items.filter((_,j)=>j!==i))}>
                   Удалить</button></td></tr>)}</tbody>
           </table>
         </div>
         {difference!==null&&<p><strong>Разница средних плотностей печени и селезёнки:
           {difference.toFixed(2)} HU.</strong> Сравнивайте лишь однородный протокол КТ; это не диагноз стеатоза.</p>}
         <button type="button" onClick={exportJson}>Сохранить все измерения в JSON</button>
       </div>}
       {note&&<p role="status">{note}</p>}
       <p><small>Только исходные однокадровые несжатые КТ с явно указанным Rescale Type=HU,
         Slope/Intercept и PixelSpacing. Контрастирование, калибровка и
         локализация органа автоматически не проверяются. Не является
         диагностикой остеопороза, стеатоза, опухоли или фиброза.</small></p>
     </>}
 </section>;
}
