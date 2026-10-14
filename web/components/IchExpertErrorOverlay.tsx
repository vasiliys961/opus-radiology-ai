"use client";

import {useEffect,useRef,useState} from "react";
import {readNativeIchKSlice} from "../lib/ich-native-slice";
import {automaticCtWindow,grayscaleCt} from "../lib/ich-ct-window";
import type {IchResearchReport} from "../lib/ich-research";

const windows={
 auto:{center:0,width:1,label:"Авто · нормализованная КТ"},
 brain:{center:40,width:80,label:"Мозговое"},
 wide:{center:80,width:200,label:"Широкое"},
} as const;
type W=keyof typeof windows;
type ReviewLayer="errors"|"prediction"|"expert"|"ct"|"subtype";
type NativeSlice=Awaited<ReturnType<typeof readNativeIchKSlice>>;

/** An actual source-pixel comparison of a trained ICH mask and expert labels.
 * Source/algorithm/expert files must all have been SHA verified by parents.
 * TP/FP/FN are pixel-wise overlap classes, not a diagnosis or clinical FP rate.
 */
export default function IchExpertErrorOverlay({source,mask,expert,referenceLabel,modelReport,jumpTo,subtypeFocus}:{
 source:File;mask:File;expert:File;referenceLabel:number;modelReport:IchResearchReport;
 jumpTo?:{sliceIndex:number;requestId:number}|null;
 subtypeFocus?:{file:File;label:number;subtype:string;requestId:number}|null;
}){
 const {dimensions,affineRas}=modelReport.source.geometry;
 const largest=modelReport.prediction.largestComponents[0];
 const initial=largest?Math.floor((largest.boundsVoxelMin[2]+largest.boundsVoxelMax[2])/2):
   Math.floor(dimensions[2]/2);
 const section=useRef<HTMLElement|null>(null);
 const [slice,setSlice]=useState(initial);
 // A new requestId makes repeat visits work after the radiologist has moved the slider.
 // This viewer decodes ONLY the native third array dimension (k).
 useEffect(()=>{
   if(jumpTo && Number.isSafeInteger(jumpTo.sliceIndex) &&
      jumpTo.sliceIndex>=0 && jumpTo.sliceIndex<dimensions[2])
     {
       setSlice(jumpTo.sliceIndex);
       section.current?.scrollIntoView({behavior:"smooth",block:"start"});
     }
 },[jumpTo?.requestId,jumpTo?.sliceIndex,dimensions]);
 const [window,setWindow]=useState<W>("auto");
 const [reviewLayer,setReviewLayer]=useState<ReviewLayer>("errors");
 useEffect(()=>{
   setReviewLayer(subtypeFocus?"subtype":"errors");
 },[subtypeFocus?.file,subtypeFocus?.label,subtypeFocus?.requestId]);
 const [opacity,setOpacity]=useState(65);
 // Cache exactly one verified native k-slice per file trio. Toggling window,
 // view or opacity must NOT decompress three 3D NIfTI files again on M1/8GB.
 const decoded=useRef<{
   source:File;mask:File;expert:File;modelReport:IchResearchReport;
   referenceLabel:number;slice:number;
   ct:NativeSlice;predicted:NativeSlice;annotated:NativeSlice;
   subtypeFile:File|null;subtypeLabel:number|null;subtypeSlice:NativeSlice|null;
 }|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 const [counts,setCounts]=useState<[number,number,number]|null>(null);
 const [subtypeCounts,setSubtypeCounts]=useState<[number,number]|null>(null);
 const canvas=useRef<HTMLCanvasElement|null>(null);
 useEffect(()=>{
   const controller=new AbortController();
   let active=true;
   setLoading(true);setError("");setCounts(null);setSubtypeCounts(null);
   const focus=reviewLayer==="subtype"?subtypeFocus:null;
   const prev=decoded.current;
   const cached=prev?.source===source&&prev.mask===mask&&prev.expert===expert&&
      prev.modelReport===modelReport&&prev.referenceLabel===referenceLabel&&
      prev.slice===slice&&prev.subtypeFile===(focus?.file??null)&&
      prev.subtypeLabel===(focus?.label??null);
   const pixels=cached&&prev?
     Promise.resolve([prev.ct,prev.predicted,prev.annotated,prev.subtypeSlice] as const):
     Promise.all([
       readNativeIchKSlice(source,"ct",slice,dimensions,affineRas,controller.signal),
       readNativeIchKSlice(mask,"mask",slice,dimensions,affineRas,controller.signal),
       readNativeIchKSlice(expert,"expert",slice,dimensions,affineRas,controller.signal,referenceLabel),
       ...(focus?[readNativeIchKSlice(
         focus.file,"expert",slice,dimensions,affineRas,controller.signal,focus.label)]:[]),
     ]);
   pixels.then(([ct,predicted,annotated,focused])=>{
     if(!active||controller.signal.aborted)return;
     const subtypeSlice=focused??null;
     if(!cached)decoded.current={source,mask,expert,modelReport,referenceLabel,slice,
        ct,predicted,annotated,subtypeFile:focus?.file??null,
        subtypeLabel:focus?.label??null,subtypeSlice};
     const context=canvas.current?.getContext("2d",{alpha:false});
     if(!context)throw Error("Невозможно отрисовать исходный срез.");
     const [width,height]=ct.dimensions;
     const img=context.createImageData(width,height);
     const win=window==="auto"?automaticCtWindow(ct.pixels as Float32Array):windows[window];
     let tp=0,fp=0,fn=0,subtypeHit=0,subtypeMiss=0;
     for(let i=0;i<width*height;i++){
       const value=(ct.pixels as Float32Array)[i];
       const g=grayscaleCt(value,win);
       const p=(predicted.pixels as Uint8Array)[i]===1;
       const e=(annotated.pixels as Uint8Array)[i]===1;
       if(p&&e)tp++;
       else if(p)fp++;
       else if(e)fn++;
       const classVoxel=(subtypeSlice?.pixels as Uint8Array|undefined)?.[i]===1;
       if(classVoxel){
         if(p)subtypeHit++;else subtypeMiss++;
       }
       let tint:[number,number,number]|null=null;
       if(reviewLayer==="errors"){
         if(p&&e)tint=[40,225,130];
         else if(p)tint=[250,75,70];
         else if(e)tint=[245,220,65];
       }else if(reviewLayer==="subtype"&&classVoxel){
         // The binary model does not distinguish subtypes: model positives
         // outside THIS expert subtype must not be called subtype FPs.
         tint=p?[40,225,130]:[245,220,65];
       }else if(reviewLayer==="prediction"&&p)tint=[250,75,70];
       else if(reviewLayer==="expert"&&e)tint=[245,220,65];
       const alpha=opacity/100;
       const rgb:[number,number,number]=tint?
         [0,1,2].map(k=>Math.round(g*(1-alpha)+tint[k]*alpha)) as [number,number,number]:
         [g,g,g];
       const at=i*4;
       img.data[at]=rgb[0];img.data[at+1]=rgb[1];img.data[at+2]=rgb[2];img.data[at+3]=255;
     }
     context.putImageData(img,0,0);
     setCounts([tp,fp,fn]);
     setSubtypeCounts(focus?[subtypeHit,subtypeMiss]:null);
     setLoading(false);
   }).catch(e=>{
     if(active&&!controller.signal.aborted){setError(e instanceof Error?e.message:"Не удалось сопоставить изображения.");setLoading(false);}
   });
   return ()=>{active=false;controller.abort();};
 },[source,mask,expert,referenceLabel,modelReport,dimensions,affineRas,slice,window,reviewLayer,opacity,subtypeFocus]);
 return <section ref={section} aria-label="Ошибки сегментации кровоизлияния на исходной КТ"
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
   <label>Показывать
     <select value={reviewLayer} onChange={e=>setReviewLayer(e.target.value as ReviewLayer)}>
       <option value="errors">Сопоставление TP / FP / FN</option>
       <option value="ct">Только исходная КТ (без масок)</option>
       <option value="prediction">Только маска SAMIHS на КТ</option>
       <option value="expert">Только экспертная маска на КТ</option>
       {subtypeFocus&&<option value="subtype">Экспертный {subtypeFocus.subtype} · FN выбранного типа</option>}
     </select>
   </label>
   <label>Непрозрачность маски: {opacity}%
     <input type="range" min="20" max="90" step="5" value={opacity}
       onChange={e=>setOpacity(Number(e.target.value))}/>
   </label>
   <p><small>Автоконтраст рассчитан для текущего среза без допущения, что значения пикселей равны HU. Предустановленные окна не подтверждают единицы HU.</small></p>
   <p><span style={{color:"#2fc58b"}}>■</span> Совпадение обеих масок (TP)
      {" · "}<span style={{color:"#ef6c62"}}>■</span> Только модель (FP)
      {" · "}<span style={{color:"#d7ad1c"}}>■</span> Только эксперт (FN)</p>
   {reviewLayer==="subtype"&&subtypeFocus&&subtypeCounts&&
     <p role="status">Экспертный {subtypeFocus.subtype} (метка {subtypeFocus.label}):
       перекрыто бинарной SAMIHS {subtypeCounts[0]} вокс.,
       пропущено {subtypeCounts[1]} вокс. на этом k-срезе.
       Другие положительные воксели модели не считаются FP этого типа.</p>}
   {reviewLayer!=="subtype"&&counts&&<p role="status">На текущем срезе: TP {counts[0]}, FP {counts[1]},
     FN {counts[2]} вокселей. Это оценка совпадения меток, не диагностическая чувствительность.</p>}}
   {loading&&<p role="status">Чтение и сравнение исходного среза…</p>}
   {error&&<p role="alert">{error}</p>}
   <canvas ref={canvas} width={dimensions[0]} height={dimensions[1]}
     style={{display:"block",width:"100%",maxWidth:512,
       aspectRatio:dimensions[0]+"/"+dimensions[1],border:"1px solid #50665f"}}/>
   {subtypeFocus&&<p><small>Экспертный тип получен только из проверенной оригинальной
     многоклассовой NIfTI-разметки. Бинарная SAMIHS сама не распознаёт
     IPH/IVH/SAH/SDH/EDH, а наложение оценивает только воксельное перекрытие.</small></p>}
   <p><small>Переключение режима отображения и окна использует уже проверенные
     пиксели текущего среза в локальной памяти; смена k заново читает файлы.
     Нативная плоскость k не удостоверена как радиологический аксиальный срез.
     Вывод относится только к воксельному совпадению двух исследовательских масок;
     соответствие исходным DICOM SOP UID, достоверность экспертной разметки,
     отсутствие пересечения с обучением и клиническое качество модели не доказаны.</small></p>
 </section>;
}
