"use client";
import {useEffect,useRef,useState} from "react";
import {readNativeIchKSlice} from "../lib/ich-native-slice";
import type {IchResearchReport} from "../lib/ich-research";

const WINDOWS={
 brain:{center:40,width:80,label:"Мозговое (предполагаемые HU)"},
 subdural:{center:80,width:200,label:"Широкое"},
 bone:{center:400,width:1800,label:"Костное"},
} as const;
type WindowKey=keyof typeof WINDOWS;

/** Only source/mask bytes already SHA-confirmed by the parent component.
 * Native k-index view, NOT a claimed anatomical axial DICOM view.
 */
export default function IchNativeOverlay({source,mask,report}:{
 source:File;mask:File;report:IchResearchReport;
}){
 const {dimensions,affineRas}=report.source.geometry;
 const largest=report.prediction.largestComponents[0];
 const initial=largest?
   Math.floor((largest.boundsVoxelMin[2]+largest.boundsVoxelMax[2])/2):
   Math.floor(dimensions[2]/2);
 const [slice,setSlice]=useState(initial);
 const [windowKey,setWindowKey]=useState<WindowKey>("brain");
 const [showMask,setShowMask]=useState(true);
 const [error,setError]=useState("");
 const [reading,setReading]=useState(false);
 const canvas=useRef<HTMLCanvasElement|null>(null);
 useEffect(()=>{
   const controller=new AbortController();
   let active=true;
   setReading(true);setError("");
   Promise.all([
     readNativeIchKSlice(source,"ct",slice,dimensions,affineRas,controller.signal),
     readNativeIchKSlice(mask,"mask",slice,dimensions,affineRas,controller.signal),
   ]).then(([ct,seg])=>{
     if(!active||controller.signal.aborted)return;
     const target=canvas.current,ctx=target?.getContext("2d",{alpha:false});
     if(!ctx)throw Error("Canvas 2D недоступен.");
     const w=dimensions[0],h=dimensions[1];
     target!.width=w;target!.height=h;
     const rgba=ctx.createImageData(w,h);
     const win=WINDOWS[windowKey],low=win.center-win.width/2;
     for(let i=0;i<w*h;i++){
       const value=(ct.pixels as Float32Array)[i];
       const grey=Math.round(Math.max(0,Math.min(255,255*(value-low)/win.width)));
       const lesion=showMask&&(seg.pixels as Uint8Array)[i]===1;
       const at=i*4;
       rgba.data[at]=lesion?Math.round(0.65*245+0.35*grey):grey;
       rgba.data[at+1]=lesion?Math.round(0.35*grey):grey;
       rgba.data[at+2]=lesion?Math.round(0.35*grey):grey;
       rgba.data[at+3]=255;
     }
     ctx.putImageData(rgba,0,0);
     const components=report.prediction.largestComponents.slice(0,12);
     ctx.save();ctx.strokeStyle="#ffbf56";ctx.lineWidth=1.5;
     for(const c of components){
       if(slice<c.boundsVoxelMin[2]||slice>c.boundsVoxelMax[2])continue;
       ctx.strokeRect(c.boundsVoxelMin[0],c.boundsVoxelMin[1],
         c.boundsVoxelMax[0]-c.boundsVoxelMin[0]+1,
         c.boundsVoxelMax[1]-c.boundsVoxelMin[1]+1);
     }
     ctx.restore();
     setReading(false);
   }).catch(e=>{if(active&&!controller.signal.aborted){
     setError(e instanceof Error?e.message:"Срез недоступен.");setReading(false);
   }});
   return ()=>{active=false;controller.abort();};
 },[source,mask,slice,windowKey,showMask,report,dimensions,affineRas]);
 return <section aria-label="Исходный NIfTI с бинарной маской SAMIHS"
   style={{padding:12,border:"1px solid #839b93",borderRadius:8,margin:"14px 0"}}>
   <h4>Исходная КТ + маска SAMIHS · нативные срезы</h4>
   <p>Пиксели взяты из локальной исходной 3D-КТ, а красная область — из отдельного
     файла бинарной маски, чьи SHA-256 совпали с импортированным отчётом.
     Не синтетический пример и не визуализация без данных.</p>
   <label>Индекс k: {slice+1}/{dimensions[2]}
     <input type="range" min="0" max={dimensions[2]-1} step="1"
       value={slice} onChange={e=>setSlice(Number(e.target.value))}/>
   </label>
   <label>Окно изображения
     <select value={windowKey} onChange={e=>setWindowKey(e.target.value as WindowKey)}>
       {Object.entries(WINDOWS).map(([key,item])=>
         <option value={key} key={key}>{item.label}</option>)}
     </select>
   </label>
   <label><input type="checkbox" checked={showMask} onChange={e=>setShowMask(e.target.checked)}/>
     Отображать бинарную маску</label>
   <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
     {report.prediction.largestComponents.slice(0,8).map(c=>
       <button type="button" key={c.componentIndex}
         onClick={()=>setSlice(Math.floor((c.boundsVoxelMin[2]+c.boundsVoxelMax[2])/2))}>
         Кандидат {c.componentIndex+1} · {c.volumeMl.toFixed(1)} мл
       </button>)}
   </div>
   {reading&&<p role="status">Чтение одного исходного среза и маски…</p>}
   {error&&<p role="alert">{error}</p>}
   <canvas ref={canvas} width={dimensions[0]} height={dimensions[1]}
     style={{display:"block",width:"100%",maxWidth:512,
       aspectRatio:dimensions[0]+"/"+dimensions[1],
       border:"1px solid #5f7470",marginTop:10}}/>
   <p><small>Оранжевые прямоугольники — проекции 3D-боксов предполагаемых компонентов,
     а не доказанные границы гематом. Отображается исходный индексный срез k,
     который нельзя автоматически называть аксиальным DICOM-срезом.
     Проверка клинической точности, типа кровоизлияния и соответствия исходным SOP UID
     ещё необходима. При смене среза потоковая распаковка начинается заново;
     полный 3D-объём на Mac не выделяется.</small></p>
 </section>;
}
