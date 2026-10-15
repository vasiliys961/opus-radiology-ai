"use client";

import {useEffect,useRef,useState} from "react";
import type {IchAlternativeReport} from "../lib/ianpan-ich-report";
import {readNiftiCtHeader,verifyNiftiCtSource,renderNativeCtPlane,
  type NiftiCtSource,type NativeCtSlab} from "../lib/nifti-ct-review";
import {readVerifiedIchNativeSlice,validateIchSourceNativeGeometry,
  type SourceIchBox} from "../lib/ich-source-ct-visual";

type VerifiedSource={file:File;source:NiftiCtSource;boxes:SourceIchBox[]};
const WINDOWS={
  brain:{label:"Мозговое окно · C 40 / W 80",center:40,width:80},
  subdural:{label:"Широкое окно · C 80 / W 200",center:80,width:200},
  bone:{label:"Костное окно · C 500 / W 2500",center:500,width:2500},
} as const;
type Window=keyof typeof WINDOWS;

/** On-screen, original-voxel review of a separately authorized LOCAL NIfTI.
 * NO patient image transmission, no DICOM matching, no trained inference.
 */
export default function IchSourceNativeReview({report}:{report:IchAlternativeReport}){
  const [verified,setVerified]=useState<VerifiedSource|null>(null);
  const [slab,setSlab]=useState<NativeCtSlab|null>(null);
  const [index,setIndex]=useState(0);
  const [windowKey,setWindowKey]=useState<Window>("brain");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [selectedPixel,setSelectedPixel]=useState<{x:number;y:number;value:number}|null>(null);
  const serial=useRef(0);
  const inFlight=useRef<AbortController|null>(null);
  const canvas=useRef<HTMLCanvasElement|null>(null);
  const validatedSha=report.source.niftiSha256;
  useEffect(()=>()=>{
    serial.current++;
    inFlight.current?.abort();
  },[]);
  useEffect(()=>{
    // The report may be replaced while the browser still holds old pixels.
    serial.current++;
    inFlight.current?.abort();
    setVerified(null);setSlab(null);setSelectedPixel(null);setError("");
  },[report]);
  const openSource=async(file:File)=>{
    const sequence=++serial.current;
    inFlight.current?.abort();
    const controller=new AbortController();
    inFlight.current=controller;
    setVerified(null);setSlab(null);setSelectedPixel(null);setBusy(true);setError("");
    try{
      if(!file.name.toLowerCase().endsWith(".nii"))
        throw Error("Нужен исходный несжатый NIfTI-1 .nii, а не .nii.gz.");
      const source=await readNiftiCtHeader(file);
      await verifyNiftiCtSource(file,validatedSha,controller.signal);
      if(sequence!==serial.current||controller.signal.aborted)return;
      const boxes=validateIchSourceNativeGeometry(report,source);
      // Start at the highest-scoring source-bound specific-subtype box.
      const strongest=[...boxes].sort((a,b)=>
        b.rawUncalibratedScore-a.rawUncalibratedScore)[0];
      setIndex(strongest?.modelSourceSliceIndex??Math.floor(source.dimensions[2]/2));
      setVerified({file,source,boxes});
    }catch(err){
      if(sequence===serial.current&&!controller.signal.aborted)
        setError(err instanceof Error?err.message:"Исходная КТ не прошла проверку.");
    }finally{if(sequence===serial.current)setBusy(false);}
  };
  useEffect(()=>{
    if(!verified){setSlab(null);return;}
    const controller=new AbortController();
    setSlab(null);setSelectedPixel(null);
    void readVerifiedIchNativeSlice(verified.file,verified.source,validatedSha,
      index,controller.signal).then(s=>{
        if(!controller.signal.aborted)setSlab(s);
      }).catch(err=>{
        if(!controller.signal.aborted)
          setError(err instanceof Error?err.message:"Не удалось открыть срез.");
      });
    return ()=>controller.abort();
  },[verified,index,validatedSha]);
  useEffect(()=>{
    if(!slab||!verified||!canvas.current)return;
    const canvasElement=canvas.current;
    const ctx=canvasElement.getContext("2d",{alpha:false});
    if(!ctx)return;
    const [nx,ny]=slab.dimensions;
    const scale=384/Math.max(nx,ny);
    const w=Math.max(1,Math.round(nx*scale));
    const h=Math.max(1,Math.round(ny*scale));
    const {center,width}=WINDOWS[windowKey];
    const rgba=renderNativeCtPlane(slab,"k",0,w,h,center,width);
    canvasElement.width=w;canvasElement.height=h;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),w,h),0,0);
    const sameSlice=verified.boxes.filter(b=>b.modelSourceSliceIndex===index);
    ctx.save();ctx.strokeStyle="#df59a9";ctx.lineWidth=2;
    ctx.setLineDash([6,4]); // An unverified model proposal, NEVER a clinical contour.
    for(const b of sameSlice){
      const [x0,y0,,x1,y1]=b.sourceVoxelBoundingBoxXYZ;
      ctx.strokeRect(x0*w/nx,y0*h/ny,(x1-x0+1)*w/nx,(y1-y0+1)*h/ny);
    }
    ctx.restore();
  },[slab,verified,index,windowKey]);
  return <section style={{marginTop:12,padding:12,border:"1px solid #83918d",borderRadius:8}}
    aria-label="Исходная КТ и модельные области кровоизлияния">
    <h4>Оригинальные КТ-воксели · независимый локальный просмотр</h4>
    <p>Исследователь может открыть <strong>оригинальную несжатую NIfTI КТ</strong>
      в браузере. Перед просмотром проверяется SHA-256 всего файла и
      соответствие физической геометрии каждой модельной области исходным
      вокселям. Никто не загружает КТ на сервер; нейросеть здесь не запускается.</p>
    <label>Проверенная исходная CT NIfTI (.nii)
      <input type="file" accept=".nii,application/octet-stream" disabled={busy}
        onChange={e=>{
          const selected=e.currentTarget.files?.[0];e.currentTarget.value="";
          if(selected)void openSource(selected);
        }}/>
    </label>
    {busy&&<p role="status">Сверка полного SHA-256 КТ с настоящим результатом модели…</p>}
    {error&&<p role="alert">{error}</p>}
    {!verified?<p><small>Исходное изображение не загружено. Числовые находки
      выше не означают диагноз; картинка не восстанавливается из одних
      модельных рамок. Открывать разрешается только исследование с точным
      SHA-256 текущего отчёта.</small></p>:<div>
      <p role="status">Подтверждено совпадение исходной NIfTI КТ и пространственной
        ориентации {verified.boxes.length} исследовательских модельных рамок.
        Источник: {verified.source.dimensions.join(" × ")} вокселей.
        DICOM SOP и клиническая точность не проверены.</p>
      <label>Окно КТ <select value={windowKey}
        onChange={e=>setWindowKey(e.target.value as Window)}>
        {Object.entries(WINDOWS).map(([k,w])=><option key={k} value={k}>{w.label}</option>)}
      </select></label>
      <div style={{display:"flex",alignItems:"center",gap:8,margin:"8px 0"}}>
        <button type="button" disabled={index<=0} onClick={()=>setIndex(v=>v-1)}>← Срез</button>
        <label>Исходный срез {index+1}/{verified.source.dimensions[2]}
          <input type="range" min={0} max={verified.source.dimensions[2]-1}
            value={index} onChange={e=>setIndex(Number(e.target.value))}/>
        </label>
        <button type="button" disabled={index>=verified.source.dimensions[2]-1}
          onClick={()=>setIndex(v=>v+1)}>Срез →</button>
      </div>
      <canvas ref={canvas}
        aria-label="Оригинальный нативный NIfTI срез с пунктирными областями модели"
        onClick={e=>{
          if(!slab)return;
          const rect=e.currentTarget.getBoundingClientRect();
          if(rect.width<=0||rect.height<=0)return;
          const [nx,ny]=slab.dimensions;
          const x=Math.max(0,Math.min(nx-1,Math.floor(
            (e.clientX-rect.left)*nx/rect.width)));
          const y=Math.max(0,Math.min(ny-1,Math.floor(
            (e.clientY-rect.top)*ny/rect.height)));
          setSelectedPixel({x,y,value:slab.pixels[x+y*nx]});
        }}
        style={{display:"block",width:"100%",maxWidth:384,height:"auto",
          aspectRatio:"1 / 1",imageRendering:"auto",border:"1px solid #777",
          margin:"10px 0",cursor:"crosshair"}}/>
      {selectedPixel&&<p role="status">Воксель
        {" "}{selectedPixel.x}/{selectedPixel.y}/{index} · исходная
        интенсивность {selectedPixel.value.toFixed(1)} (HU-подобная,
        рескейл оригинального DICOM отдельно не проверен).</p>}
      <p><small>Пурпурный пунктир — ограничивающая область модели на оригинальном
        срезе, НЕ контур крови, не подтверждённый диагноз и не экспертная маска.
        Опубликованные маски перифокального отёка нельзя использовать
        как достоверную сегментацию кровоизлияния.
        Нативная индексная ориентация не гарантирует радиологический порядок.</small></p>
      <button type="button" onClick={()=>{
        serial.current++;inFlight.current?.abort();setVerified(null);
        setSlab(null);setSelectedPixel(null);
      }}>Закрыть локальную исходную КТ</button>
    </div>}
  </section>;
}
