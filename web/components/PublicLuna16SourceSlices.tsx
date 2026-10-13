"use client";
import {useEffect, useRef, useState} from "react";
import {sha256} from "@noble/hashes/sha2.js";

type Geometry={dimensions:number[];spacingMm:number[];origin:number[];directionMatrix:number[][]};
type Reference={
  referenceNodules:Array<{
    centerMm:number[];
    diameterMm:number;
    nativeVoxelIndex:number[];
    sliceIndex0Based:number;
  }>;
  sourceGeometry:Geometry;
};
type Preset="lung"|"soft_tissue"|"bone";
const windows:Record<Preset,{center:number;width:number;label:string}>={
  lung:{center:-600,width:1500,label:"Лёгочное"},
  soft_tissue:{center:40,width:400,label:"Мягкие ткани"},
  bone:{center:400,width:1800,label:"Костное"},
};
const RAW_URL="https://huggingface.co/datasets/Yousra0x0/LUNA16_RAW/resolve/af8fdf04c27dcaa97ccfd755043d8096299d6a40/subset0/1.3.6.1.4.1.14519.5.2.1.6279.6001.395623571499047043765181005112.raw";

/** Displays ONLY hash-matched, browser-local, public LUNA16 native source pixels.
 * Not a DICOM viewer: no SOP linking, no automatic MONAI candidate overlay.
 */
export default function PublicLuna16SourceSlices({reference,rawSha256}:{
  reference:Reference;rawSha256:string;
}){
  const canvas=useRef<HTMLCanvasElement|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [validating,setValidating]=useState(false);
  const [progress,setProgress]=useState(0);
  const [slice,setSlice]=useState(reference.referenceNodules[0].sliceIndex0Based);
  const [preset,setPreset]=useState<Preset>("lung");
  const [error,setError]=useState("");
  const [displayError,setDisplayError]=useState("");
  const g=reference.sourceGeometry;
  const [w,h,depth]=g.dimensions;
  const nodule=reference.referenceNodules[0];
  const expectedBytes=w*h*depth*2;

  async function load(fileCandidate:File){
    setFile(null);setValidating(true);setError("");setProgress(0);setDisplayError("");
    try{
      if(!Number.isSafeInteger(expectedBytes)||expectedBytes<2||
         fileCandidate.size!==expectedBytes)
        throw Error("Размер RAW не соответствует исходному публичному объёму.");
      if(!/^[0-9a-f]{64}$/.test(rawSha256))throw Error("Нет проверенного SHA-256 публичных пикселей.");
      const digest=sha256.create();
      for(let offset=0;offset<fileCandidate.size;offset+=2*1024*1024){
        const block=new Uint8Array(await fileCandidate.slice(offset,Math.min(offset+2*1024*1024,fileCandidate.size)).arrayBuffer());
        digest.update(block);
        setProgress(Math.round(100*Math.min(offset+block.byteLength,fileCandidate.size)/fileCandidate.size));
      }
      const actual=Array.from(digest.digest(),v=>v.toString(16).padStart(2,"0")).join("");
      if(actual!==rawSha256)throw Error("SHA-256 RAW не совпадает с публичным исходником. Пиксели не будут отображены.");
      setSlice(nodule.sliceIndex0Based);setFile(fileCandidate);
    }catch(e){setError(e instanceof Error?e.message:"Не удалось открыть публичную КТ.");}
    finally{setValidating(false);}
  }
  useEffect(()=>{
    if(!file)return;
    const target=canvas.current;
    const context=target?.getContext("2d",{alpha:false});
    if(!context){setDisplayError("Canvas 2D не поддерживается.");return;}
    let cancelled=false;
    const index=Math.max(0,Math.min(depth-1,slice));
    const bytesPerSlice=w*h*2;
    const start=bytesPerSlice*index;
    file.slice(start,start+bytesPerSlice).arrayBuffer().then(data=>{
      if(cancelled)return;
      if(data.byteLength!==bytesPerSlice)throw Error("Неполный исходный срез.");
      const pixels=new DataView(data);
      const output=context.createImageData(w,h);
      const {center,width}=windows[preset],low=center-width/2;
      for(let i=0;i<w*h;i++){
        const value=pixels.getInt16(i*2,true);
        const grey=Math.round(Math.max(0,Math.min(255,(value-low)*255/width)));
        const offset=i*4;
        output.data[offset]=grey;
        output.data[offset+1]=grey;
        output.data[offset+2]=grey;
        output.data[offset+3]=255;
      }
      context.putImageData(output,0,0);
      const dz=Math.abs(index-nodule.nativeVoxelIndex[2])*g.spacingMm[2];
      if(dz<=nodule.diameterMm/2){
        const radiusMm=Math.sqrt(Math.max(0,(nodule.diameterMm/2)**2-dz**2));
        context.save();
        context.beginPath();
        context.strokeStyle="#ffbe4a";
        context.lineWidth=1.5;
        context.ellipse(nodule.nativeVoxelIndex[0],nodule.nativeVoxelIndex[1],
          Math.max(2,radiusMm/g.spacingMm[0]),Math.max(2,radiusMm/g.spacingMm[1]),0,0,2*Math.PI);
        context.stroke();
        context.restore();
      }
      setDisplayError("");
    }).catch(e=>{if(!cancelled)setDisplayError(e instanceof Error?e.message:"Срез не читается.");});
    return()=>{cancelled=true;};
  },[file,slice,preset,w,h,depth,nodule.nativeVoxelIndex,nodule.diameterMm,g.spacingMm]);

  return <section aria-label="Исходные пиксели публичной КТ LUNA16"
    style={{border:"1px solid #778c86",padding:12,borderRadius:8,margin:"12px 0"}}>
    <h4>Исходные пиксели КТ · LUNA16</h4>
    <p>Исследовательский просмотр настоящего среза MetaImage, а не модели и не синтетического изображения.
      Сначала загрузите <a href={RAW_URL} target="_blank" rel="noopener noreferrer">оригинальный публичный .raw</a>
      {" "}({(expectedBytes/1048576).toFixed(1)} МиБ). Только точное совпадение SHA-256 разрешает просмотр.</p>
    <label>Исходный файл .raw (проверяется локально)
      <input type="file" accept=".raw,application/octet-stream" disabled={validating}
        onChange={e=>{const selected=e.target.files?.[0];e.currentTarget.value="";if(selected)void load(selected);}}/>
    </label>
    {validating&&<p role="status">Проверка подлинности исходных пикселей: {progress}%</p>}
    {error&&<p role="alert">{error}</p>}
    {file&&<>
      <p role="status">Полный SHA-256 совпал. Просмотр только в браузере; пиксели не передаются на сервер.</p>
      <label>Срез {slice+1} из {depth}
        <input type="range" min="0" max={depth-1} step="1" value={slice}
          onChange={e=>setSlice(Number(e.target.value))}/>
      </label>
      <button type="button" onClick={()=>setSlice(nodule.sliceIndex0Based)}>Перейти к эталонному узлу</button>
      <label>Окно КТ
        <select value={preset} onChange={e=>setPreset(e.target.value as Preset)}>
          {Object.entries(windows).map(([key,item])=>
            <option key={key} value={key}>{item.label}</option>)}
        </select>
      </label>
      <canvas ref={canvas} width={w} height={h} style={{width:"100%",maxWidth:512,aspectRatio:w+"/"+h,
        display:"block",margin:"10px 0",imageRendering:"auto",border:"1px solid #666"}}/>
      {displayError&&<p role="alert">{displayError}</p>}
      <p><small>Оранжевый эллипс — условная сферическая визуализация по опубликованным экспертным центру и диаметру; это не нарисованный радиологом контур и не сегментация,
        это не подтверждённый контур MONAI. Ориентация — нативный порядок строк RAW, не радиологический стандарт.
        Сопоставление MONAI→исходная КТ и DICOM/SOP UID всё ещё не подтверждено.</small></p>
    </>}
  </section>;
}
