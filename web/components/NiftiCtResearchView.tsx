"use client";

import {useEffect,useRef,useState} from "react";
import {readNiftiMaskFile, type LabelMask} from "../lib/segmentation-mask";
import {sha256} from "../lib/analysis-package";
import {parseResearchAnatomy,type AnatomyProof} from "../lib/totalseg-abdomen-import";
import {buildResearchAnatomyRegions,type LobeRegion} from "../lib/totalseg-lobe-navigation";
import {readNiftiCtHeader,loadNativeCtSlab,assertSameNativeIndexGrid,
  renderNativeCtPlane,type IndexPlane,type NativeCtSlab} from "../lib/nifti-ct-review";

type Opened={slab:NativeCtSlab;mask:LabelMask;proof:AnatomyProof;regions:LobeRegion[]};
const PLANES:[IndexPlane,string,number,number][]=[
  ["k","Ось k · индексный срез",0,1],
  ["j","Ось j · индексный срез",0,2],
  ["i","Ось i · индексный срез",1,2],
];
function canvasSize(slab:NativeCtSlab,a:number,b:number):[number,number]{
  const dims=slab.dimensions;
  const mm=(axis:number)=>Math.hypot(slab.affineLps[axis],
    slab.affineLps[4+axis],slab.affineLps[8+axis]);
  const x=dims[a]*mm(a),y=dims[b]*mm(b);
  const scale=320/Math.max(x,y);
  return [Math.max(1,Math.round(x*scale)),Math.max(1,Math.round(y*scale))];
}
function NativeSlice({study,plane,coord,center,width,label,opacity}:{
  study:Opened;plane:IndexPlane;coord:number;center:number;width:number;
  label:number|null;opacity:number;
}){
  const ref=useRef<HTMLCanvasElement|null>(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const info=PLANES.find(([p])=>p===plane)!;
    const [w,h]=canvasSize(study.slab,info[2],info[3]);
    const rgba=renderNativeCtPlane(study.slab,plane,coord,w,h,
      center,width,study.mask,label,opacity);
    canvas.width=w;canvas.height=h;
    canvas.getContext("2d",{alpha:false})?.putImageData(
      new ImageData(new Uint8ClampedArray(rgba),w,h),0,0);
  },[study,plane,coord,center,width,label,opacity]);
  return <div className="cs-nifti-image">
    <canvas ref={ref} aria-label={PLANES.find(([p])=>p===plane)?.[1]}
      style={{maxWidth:"100%",height:"auto",imageRendering:"pixelated"}}/>
  </div>;
}
/** Local-only source-image adapter hosted inside existing /viewer, reusing
 * segmentation-mask geometry / label parser rather than pretending CT is DICOM.
 */
export default function NiftiCtResearchView(){
  const [sourceFile,setSourceFile]=useState<File|null>(null);
  const [maskFiles,setMaskFiles]=useState<File[]>([]);
  const [opened,setOpened]=useState<Opened|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("Выберите исходную несжатую КТ .nii и пару маска .nii + паспорт .json.");
  const [pos,setPos]=useState<[number,number,number]>([0,0,0]);
  const [label,setLabel]=useState<number|null>(null);
  const [ww,setWw]=useState(400);
  const [wc,setWc]=useState(50);
  const [opacity,setOpacity]=useState(0.4);
  const serial=useRef(0);
  const currentAbort=useRef<AbortController|null>(null);
  useEffect(()=>()=>{serial.current++;currentAbort.current?.abort();},[]);
  const invalidate=()=>{
    serial.current++;currentAbort.current?.abort();setOpened(null);setError("");
    setMessage("Серия изменена: предыдущая маска и изображение выгружены из просмотра.");
  };
  const open=async()=>{
    if(!sourceFile||maskFiles.length!==2){
      setError("Нужно выбрать три файла: исходная КТ .nii, маска .nii и паспорт .json.");return;
    }
    const masks=maskFiles.filter(f=>f.name.toLowerCase().endsWith(".nii"));
    const json=maskFiles.filter(f=>f.name.toLowerCase().endsWith(".json"));
    if(masks.length!==1||json.length!==1){
      setError("Укажите ровно одну маску .nii и один JSON-паспорт.");return;
    }
    const version=++serial.current;
    currentAbort.current?.abort();
    const controller=new AbortController();
    currentAbort.current=controller;
    setLoading(true);setError("");
    setOpened(null);
    try{
      const header=await readNiftiCtHeader(sourceFile);
      if(controller.signal.aborted)return;
      const mask=await readNiftiMaskFile(masks[0]);
      const digest=await sha256(await masks[0].arrayBuffer());
      const proof=parseResearchAnatomy(await json[0].text(),mask,digest);
      if(proof.anatomy!=="abdomen")
        throw Error("В этом режиме поддерживаются только четыре органа брюшной полости.");
      const slab=await loadNativeCtSlab(sourceFile,header,proof,controller.signal);
      assertSameNativeIndexGrid(slab,mask);
      const regions=await buildResearchAnatomyRegions(mask,proof,{
        cancelled:()=>version!==serial.current||controller.signal.aborted,
      });
      if(version!==serial.current||controller.signal.aborted)return;
      setOpened({slab,mask,proof,regions});
      setPos(slab.dimensions.map(d=>Math.floor((d-1)/2)) as [number,number,number]);
      setLabel(null);
      setWc(50);setWw(400);
      setMessage("SHA полного CT NIfTI подтверждена; маска и индексная геометрия совпадают. Это технический, не клинический контроль.");
    }catch(e){
      if(version===serial.current&&!controller.signal.aborted)
        setError(e instanceof Error?e.message:"Ошибка чтения NIfTI.");
    }finally{if(version===serial.current)setLoading(false);}
  };
  const choose=(region:LobeRegion)=>{
    setPos(region.anchorMaskIndex);
    setLabel(region.id);
  };
  return <section className="cs-nifti" aria-label="Исследовательский просмотр КТ NIfTI">
    <div className="cs-intro"><div><div className="cs-kicker">IMAGING LAB / LOCAL NIFTI CT REVIEW</div>
      <h1>КТ NIfTI <em>+ маски органов</em></h1>
      <p>Тот же контур проверки исходной геометрии и масок, что и в MPR. Режим чтения только локальных файлов.</p>
      </div><span className="cs-watermark">ИССЛЕДОВАТЕЛЬСКИЙ РЕЖИМ · НЕ ДЛЯ ДИАГНОСТИКИ</span>
    </div>
    <div className="cs-nifti-controls">
      <label>Исходная КТ NIfTI <input type="file" accept=".nii"
        onChange={e=>{invalidate();setSourceFile(e.target.files?.[0]??null);e.target.value="";}}/></label>
      <label>Маска TotalSegmentator + JSON-паспорт
        <input type="file" accept=".nii,.json" multiple
          onChange={e=>{invalidate();setMaskFiles(Array.from(e.target.files??[]));e.target.value="";}}/>
      </label>
      <button type="button" disabled={loading||!sourceFile||maskFiles.length!==2}
        onClick={()=>void open()}>{loading?"Проверка CT и геометрии…":"Проверить и открыть исследование"}</button>
      <button type="button" disabled={!opened&&!sourceFile&&!maskFiles.length}
        onClick={()=>{invalidate();setSourceFile(null);setMaskFiles([]);}}>Очистить</button>
      <p role="status">{message}</p>
      {error&&<p role="alert" className="cs-nifti-error">{error}</p>}
      <small>Максимум 128 МиБ исходной несжатой КТ и 32 исходных среза в памяти.
        Устройство не обрабатывает модель, не загружает файлы на сервер и не преобразует NIfTI в DICOM.
        Контрольная сумма JSON сама по себе не удостоверяет происхождение файла или пациента.</small>
    </div>
    {opened&&<div className="cs-nifti-review">
      <h2>Оригинальные воксели CT · срезы {opened.proof.firstSlice}–{opened.proof.lastSlice}</h2>
      <p>Размер исходного тома: {opened.proof.fullDimensions.join(" × ")}.
        В памяти: {opened.slab.dimensions.join(" × ")}. Все координаты — по осям файла NIfTI,
        **не гарантированные анатомические плоскости**.</p>
      <p>Эталонное измерение Dice 0,947923 относится только к историческому публичному
        случаю MSD spleen_2 и не переносится на текущие загруженные файлы.</p>
      <div className="cs-nifti-sliders">
        <label>Оконный центр <input type="number" min="-2000" max="3000" step="10" value={wc}
          onChange={e=>setWc(Math.max(-2000,Math.min(3000,Number(e.target.value)||0)))}/></label>
        <label>Ширина окна <input type="number" min="1" max="6000" step="10" value={ww}
          onChange={e=>setWw(Math.max(1,Math.min(6000,Number(e.target.value)||1)))}/></label>
        <label>Маска, непрозрачность {Math.round(opacity*100)}%
          <input type="range" min="0" max="80" value={Math.round(opacity*100)}
            onChange={e=>setOpacity(Number(e.target.value)/100)}/></label>
        <label>Структура <select value={label??"all"}
          onChange={e=>setLabel(e.target.value==="all"?null:Number(e.target.value))}>
          <option value="all">Все органы</option>
          {opened.regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
      </div>
      <div className="cs-nifti-planes">
        {PLANES.map(([plane,title])=>{
          const idx=plane==="i"?0:plane==="j"?1:2;
          return <div className="cs-nifti-plane" key={plane}>
            <h3>{title}</h3>
            <NativeSlice study={opened} plane={plane} coord={pos[idx]} center={wc}
              width={ww} label={label} opacity={opacity}/>
            <label>Индекс {pos[idx]+1} / {opened.slab.dimensions[idx]}
              <input type="range" min="0" max={opened.slab.dimensions[idx]-1}
                value={pos[idx]} onChange={e=>setPos(old=>old.map((n,i)=>
                  i===idx?Number(e.target.value):n) as [number,number,number])}/>
            </label>
          </div>;
        })}
      </div>
      <h3>Анатомические структуры в загруженном фрагменте</h3>
      <div className="cs-nifti-organs">
        {opened.regions.map(region=><button type="button" key={region.id}
          className={label===region.id?"active":""} onClick={()=>choose(region)}>
          <strong>{region.name}</strong>
          <span>{region.voxels.toLocaleString("ru-RU")} вокселей · {region.volumeMl.toFixed(2)} мл разметки · к исходному срезу {region.originalSliceRange[0]}–{region.originalSliceRange[1]}</span>
        </button>)}
      </div>
      {opened.proof.missingLabels.length>0&&<p role="alert">
        Не найдены метки: {opened.proof.missingLabels.map(id=>opened.proof.labelNames[id]).join(", ")}.
        Это не означает отсутствие патологии или органа.
      </p>}
      <p className="cs-nifti-caution">Индексный обзор, а не медицинское заключение.
        Полный анатомический охват органов, ориентация анатомических плоскостей,
        происхождение модели и точность границ в этом исследовании не установлены.</p>
    </div>}
  </section>;
}
