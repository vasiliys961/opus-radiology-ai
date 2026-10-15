"use client";
import {useEffect, useMemo, useRef, useState} from "react";
import {projectMonaiCandidateHypothesis,type MonaiCandidate} from "../lib/monai-public-candidate-projection";
import {sha256} from "@noble/hashes/sha2.js";
import {sourceClickToMetaImagePoint,type SourceClickPoint} from "../lib/metaimage-physician-point";

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
 * The fixed independently audited MONAI world-LPS→MetaImage transform is allowed
 * only after caller validates the separate genuine-centroid comparison artifact.
 * Research source overlay is NOT a DICOM SOP registration or clinical TP.
 */
export default function PublicLuna16SourceSlices({
  reference,rawSha256,candidates=[],sourceGeometryVerified=false,
}:{
  reference:Reference;rawSha256:string;candidates?:MonaiCandidate[];
  sourceGeometryVerified?:boolean;
}){
  const canvas=useRef<HTMLCanvasElement|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [validating,setValidating]=useState(false);
  const [progress,setProgress]=useState(0);
  const [slice,setSlice]=useState(reference.referenceNodules[0].sliceIndex0Based);
  const [preset,setPreset]=useState<Preset>("lung");
  const [error,setError]=useState("");
  const [displayError,setDisplayError]=useState("");
  const [manualPoint,setManualPoint]=useState<SourceClickPoint|null>(null);
  const [selectedCandidateIndex,setSelectedCandidateIndex]=useState<number|null>(null);
  const [showHypotheses,setShowHypotheses]=useState(false);
  const g=reference.sourceGeometry;
  const [w,h,depth]=g.dimensions;
  const nodule=reference.referenceNodules[0];
  const expectedBytes=w*h*depth*2;
  // Do not evaluate a model-to-source frame hypothesis as established geometry.
  // The projection is for an explicitly labelled research visual check only.
  const hypotheses=useMemo(()=>candidates.flatMap(candidate=>{
    const projected=projectMonaiCandidateHypothesis(g,candidate);
    return projected?[projected]:[];
  }),[candidates,g]);
  const selectedHypothesis=hypotheses.find(c=>c.candidateIndex===selectedCandidateIndex);

  async function load(fileCandidate:File){
    setFile(null);setManualPoint(null);setValidating(true);setError("");setProgress(0);setDisplayError("");
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
      if(sourceGeometryVerified&&hypotheses.length){
        // Candidate #0 is the highest-scoring real positive-case proposal;
        // display it on its true source slice alongside expert reference.
        const top=[...hypotheses].sort((a,b)=>b.rawUncalibratedScore-a.rawUncalibratedScore)[0];
        setSelectedCandidateIndex(top.candidateIndex);
        setShowHypotheses(true);
        setSlice(top.sourceSliceIndexHypothesis);
      }
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
      if(showHypotheses&&selectedHypothesis&&selectedHypothesis.sourceSliceIndexHypothesis===index){
        const [px,py]=selectedHypothesis.nativeVoxelIndexHypothesis;
        context.save();context.strokeStyle="#f36cce";context.lineWidth=2;
        context.setLineDash(sourceGeometryVerified?[]:[5,3]);context.beginPath();
        context.moveTo(px-12,py);context.lineTo(px+12,py);
        context.moveTo(px,py-12);context.lineTo(px,py+12);
        context.stroke();context.restore();
      }
      if(manualPoint&&manualPoint.index3d[2]===index){
        const [x,y]=manualPoint.index3d;
        context.save();context.strokeStyle="#17e4ce";context.lineWidth=2;
        context.beginPath();context.moveTo(x-9,y);context.lineTo(x+9,y);
        context.moveTo(x,y-9);context.lineTo(x,y+9);context.stroke();context.restore();
      }
      setDisplayError("");
    }).catch(e=>{if(!cancelled)setDisplayError(e instanceof Error?e.message:"Срез не читается.");});
    return()=>{cancelled=true;};
  },[file,slice,preset,w,h,depth,nodule.nativeVoxelIndex,nodule.diameterMm,g.spacingMm,manualPoint,showHypotheses,selectedHypothesis,sourceGeometryVerified]);

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
      <div style={{margin:"12px 0",padding:10,border:"1px dashed #c17eac",borderRadius:8}}>
        <strong>Кандидаты настоящей MONAI · экспериментальная локализация</strong>
        {sourceGeometryVerified?
          <p role="note"><strong>Сопоставление исходной геометрии подтверждено для этой публичной КТ.</strong>
          Пурпурный <strong>сплошной</strong> крест — настоящий центр, полученный MONAI
          и пересчитанный из world LPS в исходный MetaImage. Оранжевое кольцо —
          независимо опубликованный экспертный центр и диаметр. Совпадение центров
          проверено отдельным GitHub Actions по SHA-256 источников и подлинному
          результату модели. Это не экспертный контур, не независимый клинический
          тест и не пациентский диагноз.</p>:
          <p role="alert">Пурпурный пунктир — только <strong>непроверенная гипотеза</strong>
          положения MONAI world в физической системе исходной MetaImage.
          Оранжевое кольцо — опубликованная экспертная аннотация,
          не предсказанная маска. Близость меток не подтверждает TP.</p>}
        {hypotheses.length===0?<p>Ни один кандидат не проецируется внутрь исходного объёма; отрицательное заключение недопустимо.</p>:
        hypotheses.map(h=><button key={h.candidateIndex} type="button" style={{margin:4}}
          onClick={()=>{setSelectedCandidateIndex(h.candidateIndex);setShowHypotheses(true);setSlice(h.sourceSliceIndexHypothesis);}}>
          Кандидат {h.candidateIndex+1} · срез {h.sourceSliceIndexHypothesis+1} {sourceGeometryVerified?"(проверенная физическая геометрия)":"(гипотеза)"} · score {h.rawUncalibratedScore.toFixed(3)}
        </button>)}
        {showHypotheses&&<button type="button" onClick={()=>{setShowHypotheses(false);setSelectedCandidateIndex(null);}}>Скрыть центр MONAI</button>}
        <p><small>Центр показывается только на исходном срезе после полной проверки SHA-256 пикселей. {sourceGeometryVerified?
          "Геометрия модели к публичной MetaImage проверена по оригинальному исходному коду MONAI и контрольной разметке. Клинические TP/FP/FN, Dice и диагностические заключения не вычислялись.":
          "Привязка к исходной системе MONAI не проверена; клиническая оценка невозможна."}</small></p>
      </div>
      <label>Окно КТ
        <select value={preset} onChange={e=>setPreset(e.target.value as Preset)}>
          {Object.entries(windows).map(([key,item])=>
            <option key={key} value={key}>{item.label}</option>)}
        </select>
      </label>
      <p><strong>Ручная локализация на исходной КТ:</strong> нажмите на подозрительную область на срезе.
        Бирюзовый крест обозначит точку, выбранную человеком, а не нейросетью.</p>
      <canvas ref={canvas} width={w} height={h}
        onClick={e=>{
          const rect=e.currentTarget.getBoundingClientRect();
          if(rect.width<=0||rect.height<=0)return;
          const x=Math.floor((e.clientX-rect.left)*w/rect.width);
          const y=Math.floor((e.clientY-rect.top)*h/rect.height);
          try{
            setManualPoint(sourceClickToMetaImagePoint(rawSha256,g,[x,y,slice]));
            setDisplayError("");
          }catch(err){setDisplayError(err instanceof Error?err.message:"Неверная ручная точка.");}
        }}
        style={{width:"100%",maxWidth:512,aspectRatio:w+"/"+h,
        display:"block",margin:"10px 0",imageRendering:"auto",border:"1px solid #666",cursor:"crosshair"}}/>
      {manualPoint&&<div>
        <p><strong>Точка врача:</strong> воксель {manualPoint.index3d.join(" / ")};
          координаты MetaImage {manualPoint.metaImagePhysicalMm.map(x=>x.toFixed(2)).join(" / ")} мм.</p>
        <p role="note">Физические координаты MetaImage не удостоверены как DICOM LPS.
          Совпадение с кандидатом MONAI не установлено; точка не означает подтверждения диагноза.</p>
        <button type="button" onClick={()=>setSlice(manualPoint.index3d[2])}>Вернуться к отмеченному срезу</button>{" "}
        <button type="button" onClick={()=>{
          const payload=new Blob([JSON.stringify(manualPoint,null,2)],{type:"application/json"});
          const url=URL.createObjectURL(payload);const a=document.createElement("a");
          a.href=url;a.download="opus-luna16-manual-source-point.json";
          document.body.appendChild(a);a.click();a.remove();
          window.setTimeout(()=>URL.revokeObjectURL(url),1000);
        }}>Скачать ручную точку с SHA-256 источника</button>{" "}
        <button type="button" onClick={()=>setManualPoint(null)}>Удалить ручную точку</button>
      </div>}
      {displayError&&<p role="alert">{displayError}</p>}
      <p><small>Оранжевый эллипс — условная сферическая визуализация по опубликованным экспертным центру и диаметру; это не нарисованный радиологом контур и не сегментация,
        это не подтверждённый контур MONAI. Пурпурный крест — локализация кандидата нейросети, не экспертный контур и не диагноз. Ориентация — нативный порядок строк RAW, не радиологический стандарт.
        {sourceGeometryVerified?
          "MONAI→MetaImage world LPS геометрия подтверждена на этом публичном исследовании. Подлинные пациентские DICOM/SOP UID не установлены.":
          "Геометрия MONAI→исходная КТ и DICOM/SOP UID не подтверждена."}</small></p>
    </>}
  </section>;
}
