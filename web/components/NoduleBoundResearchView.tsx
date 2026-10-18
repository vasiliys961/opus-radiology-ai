"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {readNoduleNiftiHeader,parseBoundNoduleReport,verifyNoduleSource,
  readNoduleAxial,type NoduleNativeSource,type BoundNoduleReport} from "../lib/live-nodule-report";

/** A real NIfTI CT + the EXACT same-source completed pretrained MONAI report.
 * All file reading, SHA, rendering and candidate selection stay browser-local.
 */
export default function NoduleBoundResearchView(){
 const [source,setSource]=useState<File|null>(null);
 const [reportFile,setReportFile]=useState<File|null>(null);
 const [ready,setReady]=useState<{source:NoduleNativeSource;report:BoundNoduleReport}|null>(null);
 const [status,setStatus]=useState("");
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [slice,setSlice]=useState(0);
 const [score,setScore]=useState(0.5);
 const [windowPreset,setWindowPreset]=useState<"lung"|"soft"|"bone">("lung");
 const [showMarks,setShowMarks]=useState(true);
 const canvas=useRef<HTMLCanvasElement|null>(null);
 const serial=useRef(0),controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>{serial.current++;controller.current?.abort();},[]);
 const reset=()=>{serial.current++;controller.current?.abort();setReady(null);setError("");setStatus("");};
 const candidates=useMemo(()=>ready?.report.candidates.filter(c=>c.score>=score&&c.nativeVoxelIndexHypothesis)
   .sort((a,b)=>b.score-a.score)??[],[ready,score]);
 async function open(){
   if(!source||!reportFile||busy)return;
   const revision=++serial.current;controller.current?.abort();const active=new AbortController();
   controller.current=active;setBusy(true);setError("");setReady(null);setStatus("Проверка NIfTI и отчёта…");
   try{
     if(reportFile.size>1024*1024)throw Error("JSON отчёта MONAI слишком большой.");
     const header=await readNoduleNiftiHeader(source);
     const result=parseBoundNoduleReport(await reportFile.text(),header);
     await verifyNoduleSource(source,result.source.sha256,active.signal);
     if(revision!==serial.current||active.signal.aborted)return;
     setSlice(0);setReady({source:header,report:result});
     setStatus("Оригинальная КТ и JSON модели связаны по SHA-256 и физической сетке. Координаты — исследовательские кандидаты, требующие ручной проверки.");
   }catch(e){if(revision===serial.current)setError(e instanceof Error?e.message:"Не удалось проверить источник.");}
   finally{if(revision===serial.current)setBusy(false);}
 }
 useEffect(()=>{
   if(!ready||!source||!canvas.current)return;
   let cancelled=false;
   const header=ready.source;
   const limits=windowPreset==="lung"?{center:-600,width:1500}:
     windowPreset==="soft"?{center:50,width:400}:{center:400,width:1800};
   readNoduleAxial(source,header,slice).then(pixels=>{
     if(cancelled||!canvas.current)return;
     const w=header.dimensions[0],h=header.dimensions[1];
     const rgba=new Uint8ClampedArray(w*h*4);
     const bottom=limits.center-limits.width/2;
     for(let i=0;i<pixels.length;i++){
       const intensity=pixels[i];
       const value=Math.max(0,Math.min(255,Math.round((intensity-bottom)/limits.width*255)));
       const p=i*4;rgba[p]=value;rgba[p+1]=value;rgba[p+2]=value;rgba[p+3]=255;
     }
     const c=canvas.current;c.width=w;c.height=h;
     const ctx=c.getContext("2d",{alpha:false});
     if(!ctx)return;
     ctx.putImageData(new ImageData(rgba,w,h),0,0);
     if(showMarks)for(const model of candidates){
       const center=model.nativeVoxelIndexHypothesis!;
       const zUnit=Math.hypot(header.affineLps[2],header.affineLps[6],header.affineLps[10]);
       if(Math.abs(center[2]-slice)*zUnit>model.extentModelMm[2]/2+zUnit)continue;
       const x=center[0],y=center[1];
       ctx.beginPath();ctx.arc(x,y,Math.max(5,model.extentModelMm[0]/3),0,2*Math.PI);
       ctx.strokeStyle="#ff734e";ctx.lineWidth=2;ctx.stroke();
       ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y);
       ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();
       ctx.font="bold 12px sans-serif";ctx.fillStyle="#fff";
       ctx.fillText(String(model.index+1),x+11,y-10);
     }
   }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Ошибка отрисовки исходного среза.");});
   return ()=>{cancelled=true;};
 },[ready,source,slice,windowPreset,candidates,showMarks]);
 return <section className="cs-nodule-bound" aria-label="Живой источник NIfTI · настоящие MONAI находки">
  <div className="cs-intro"><div><div className="cs-kicker">PATHOLOGY DETECTION / VERIFIED SOURCE</div>
    <h1>Узлы лёгких · MONAI</h1>
    <p>Настоящий обученный RetinaNet 0.6.9 на исходной исследовательской КТ. Обрабатывается отдельным CPU-исполнителем, здесь визуализируется только привязанный к исходнику результат.</p>
  </div><span className="cs-watermark">НЕ ДЛЯ КЛИНИЧЕСКОЙ ДИАГНОСТИКИ</span></div>
  <div className="cs-nodule-controls">
    <label>Исходная КТ из Opus · <code>.nii</code> (не ZIP)
      <input type="file" accept=".nii" onChange={e=>{reset();setSource(e.target.files?.[0]??null);e.target.value="";}}/>
    </label>
    <label>Результат настоящего MONAI · <code>.json</code>
      <input type="file" accept=".json,application/json" onChange={e=>{reset();setReportFile(e.target.files?.[0]??null);e.target.value="";}}/>
    </label>
    <button type="button" disabled={!source||!reportFile||busy} onClick={()=>void open()}>
      {busy?"Проверка исходного SHA-256…":"Открыть находки на исходной КТ"}
    </button>
    <p>Для первого запуска модели используется отдельный Linux CPU с предустановленным официальным checkpoint. <a href="https://github.com/vasiliys961/opus-radiology-ai/blob/feature/live-monai-nodule-source-bound/docs/MONAI_BOUND_NODULE_CT.md" target="_blank" rel="noreferrer">Запуск настоящего детектора и условия безопасности ↗</a>.</p>
    <p>Никакая КТ не передаётся в ChatGPT, OpenRouter, Polza или GitHub. Файл остаётся локальным в браузере. Эта панель НЕ запускает MONAI на Mac и не превращает исследовательский JSON в диагноз.</p>
  </div>
  {error&&<p role="alert" className="cs-nodule-error">{error}</p>}
  {status&&<p role="status" className="cs-message">{status}</p>}
  {ready&&<>
    <div className="cs-nodule-stats">
      <b>MONAI RetinaNet</b> · {ready.report.candidates.length} кандидатов на загруженной КТ.
      <span>Весовая модель SHA: {ready.report.model.weightsSha256.slice(0,16)}…</span>
      <span> Исходник {ready.source.dimensions.join("×")} вокселей · {ready.report.execution.seconds.toFixed(1)} с CPU.</span>
    </div>
    <div className="cs-nodule-view">
      <div className="cs-nodule-image">
        <canvas ref={canvas} style={{width:"100%",maxWidth:640,imageRendering:"pixelated"}} aria-label="Исходный индексный аксиальный срез КТ с исследовательскими координатами MONAI"/>
        <small>Исходный NIfTI, плоскость индексной сетки i/j. Ориентация не удостоверена как диагностическая радиологическая аксиальная.</small>
      </div>
      <aside className="cs-nodule-list">
        <h3>Кандидаты · не диагноз</h3>
        <label>Порог score модели {score.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={score} onChange={e=>setScore(+e.target.value)}/>
        </label>
        <label>Окно <select value={windowPreset} onChange={e=>setWindowPreset(e.target.value as "lung"|"soft"|"bone")}>
          <option value="lung">Лёгочное</option><option value="soft">Мягкие ткани</option><option value="bone">Костное</option>
        </select></label>
        <label><input type="checkbox" checked={showMarks} onChange={e=>setShowMarks(e.target.checked)}/> Показать координаты модели</label>
        <label>Исходный срез {slice+1} / {ready.source.dimensions[2]}
          <input type="range" min={0} max={ready.source.dimensions[2]-1} step={1} value={slice} onChange={e=>setSlice(+e.target.value)}/>
        </label>
        <div className="cs-nodule-candidates">
          {candidates.map(c=><button key={c.index} type="button" onClick={()=>setSlice(Math.max(0,Math.min(ready.source.dimensions[2]-1,Math.round(c.nativeVoxelIndexHypothesis![2]))))}>
            <b>#{c.index+1} · score {c.score.toFixed(3)}</b>
            <span>Срез {Math.round(c.nativeVoxelIndexHypothesis![2])+1} · модельный box {c.extentModelMm.map(n=>n.toFixed(1)).join("×")} мм</span>
            <small>Нажмите для перехода к кандидату</small>
          </button>)}
        </div>
        {!candidates.length&&<p>При данном пороге нет кандидатов с координатами внутри сетки. Отсутствие патологий НЕ доказано.</p>}
      </aside>
    </div>
    <p role="note" className="cs-bottom-note">Оригинальные данные совпали по SHA и NIfTI-аффинной геометрии. Однако MONAI world → исходные координаты пока не прошли независимое визуальное подтверждение; изображения не привязаны к DICOM SOP. Модель не валидирована внешней FROC, чувствительностью и специфичностью. Врач обязательно подтверждает каждую возможную находку.</p>
    <button type="button" className="cs-clear" onClick={()=>{reset();setSource(null);setReportFile(null);}}>Закрыть и очистить исследование</button>
  </>}
 </section>;
}
