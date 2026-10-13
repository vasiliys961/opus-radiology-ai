"use client";

import {useEffect,useRef,useState} from "react";
import {readNativeIchKSlice} from "../lib/ich-native-slice";
import type {IchResearchReport} from "../lib/ich-research";

const windows={
 brain:{center:40,width:80,label:"Мозговое"},
 wide:{center:80,width:200,label:"Широкое"},
} as const;
type W=keyof typeof windows;

/** An actual source-pixel comparison of a trained ICH mask and expert labels.
 * Source/algorithm/expert files must all have been SHA verified by parents.
 * TP/FP/FN are pixel-wise overlap classes, not a diagnosis or clinical FP rate.
 */
export default function IchExpertErrorOverlay({source,mask,expert,referenceLabel,modelReport}:{
 source:File;mask:File;expert:File;referenceLabel:number;modelReport:IchResearchReport;
}){
 const {dimensions,affineRas}=modelReport.source.geometry;
 const largest=modelReport.prediction.largestComponents[0];
 const initial=largest?Math.floor((largest.boundsVoxelMin[2]+largest.boundsVoxelMax[2])/2):
   Math.floor(dimensions[2]/2);
 const [slice,setSlice]=useState(initial);
 const [window,setWindow]=useState<W>("brain");
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 const [counts,setCounts]=useState<[number,number,number]|null>(null);
 const canvas=useRef<HTMLCanvasElement|null>(null);
 useEffect(()=>{
   const controller=new AbortController();
   let active=true;
   setLoading(true);setError("");setCounts(null);
   Promise.all([
     readNativeIchKSlice(source,"ct",slice,dimensions,affineRas,controller.signal),
     readNativeIchKSlice(mask,"mask",slice,dimensions,affineRas,controller.signal),
     readNativeIchKSlice(expert,"expert",slice,dimensions,affineRas,controller.signal,referenceLabel),
   ]).then(([ct,predicted,annotated])=>{
     if(!active||controller.signal.aborted)return;
     const context=canvas.current?.getContext("2d",{alpha:false});
     if(!context)throw Error("Невозможно отрисовать исходный срез.");
     const [width,height]=ct.dimensions;
     const img=context.createImageData(width,height);
     const {center,width:range}=windows[window],low=center-range/2;
     let tp=0,fp=0,fn=0;
     for(let i=0;i<width*height;i++){
       const value=(ct.pixels as Float32Array)[i];
       const g=Math.round(Math.max(0,Math.min(255,255*(value-low)/range)));
       const p=(predicted.pixels as Uint8Array)[i]===1;
       const e=(annotated.pixels as Uint8Array)[i]===1;
       let rgb:[number,number,number]=[g,g,g];
       if(p&&e){tp++;rgb=[Math.round(g*0.35+40*0.65),Math.round(g*0.35+225*0.65),Math.round(g*0.35+130*0.65)];}
       else if(p){fp++;rgb=[Math.round(g*0.35+250*0.65),Math.round(g*0.35+75*0.65),Math.round(g*0.35+70*0.65)];}
       else if(e){fn++;rgb=[Math.round(g*0.35+245*0.65),Math.round(g*0.35+220*0.65),Math.round(g*0.35+65*0.65)];}
       const at=i*4;
       img.data[at]=rgb[0];img.data[at+1]=rgb[1];img.data[at+2]=rgb[2];img.data[at+3]=255;
     }
     context.putImageData(img,0,0);
     setCounts([tp,fp,fn]);setLoading(false);
   }).catch(e=>{
     if(active&&!controller.signal.aborted){setError(e instanceof Error?e.message:"Не удалось сопоставить изображения.");setLoading(false);}
   });
   return ()=>{active=false;controller.abort();};
 },[source,mask,expert,referenceLabel,modelReport,dimensions,affineRas,slice,window]);
 return <section aria-label="Ошибки сегментации кровоизлияния на исходной КТ"
   style={{border:"1px solid #8fa6a0",borderRadius:8,padding:12,marginTop:14}}>
   <h4>КТ · где модель совпала с экспертной разметкой</h4>
   <p>Пиксели исходной КТ и обе маски читаются локально по одной индексной плоскости.
     Ни один из файлов не отправляется на сервер.</p>
   <label>Срез k {slice+1} из {dimensions[2]}
     <input type="range" min="0" max={dimensions[2]-1} step="1"
       value={slice} onChange={e=>setSlice(Number(e.target.value))}/>
   </label>
   <label>Окно КТ
     <select value={window} onChange={e=>setWindow(e.target.value as W)}>
       {Object.entries(windows).map(([key,w])=>
         <option key={key} value={key}>{w.label}</option>)}
     </select>
   </label>
   <p><span style={{color:"#2fc58b"}}>■</span> Совпадение обеих масок (TP)
      {" · "}<span style={{color:"#ef6c62"}}>■</span> Только модель (FP)
      {" · "}<span style={{color:"#d7ad1c"}}>■</span> Только эксперт (FN)</p>
   {counts&&<p role="status">На текущем срезе: TP {counts[0]}, FP {counts[1]},
     FN {counts[2]} вокселей. Это оценка совпадения меток, не диагностическая чувствительность.</p>}
   {loading&&<p role="status">Чтение и сравнение исходного среза…</p>}
   {error&&<p role="alert">{error}</p>}
   <canvas ref={canvas} width={dimensions[0]} height={dimensions[1]}
     style={{display:"block",width:"100%",maxWidth:512,
       aspectRatio:dimensions[0]+"/"+dimensions[1],border:"1px solid #50665f"}}/>
   <p><small>Нативная плоскость k не удостоверена как радиологический аксиальный срез.
     Вывод относится только к воксельному совпадению двух исследовательских масок;
     соответствие исходным DICOM SOP UID, достоверность экспертной разметки,
     отсутствие пересечения с обучением и клиническое качество модели не доказаны.</small></p>
 </section>;
}
