"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {runPublicIchWorker} from "../lib/public-ich-worker";
import type {EvidenceJson} from "../lib/evidence-json";

/** Actual pinned ianpan hemorrhage model on the CURRENT native DICOM CT.
 * No import of archived research JSON, no upload of patient images.
 */
export default function DirectIchDicomDetector({series,files}:{
 series:DicomSeries;files:ReadonlyMap<string,File>;
}){
 const [token,setToken]=useState("");
 const [endpoint,setEndpoint]=useState("http://127.0.0.1:8766");
 const [authorized,setAuthorized]=useState(false);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 const [error,setError]=useState("");
 const [result,setResult]=useState<EvidenceJson|null>(null);
 const ctrl=useRef<AbortController|null>(null);
 const rev=useRef(0);
 const eligible=useMemo(()=>series.modality==="CT"&&series.volumeReady&&series.spatiallySorted&&
  series.members.length>=8&&series.members.length<=64&&
  series.members.every(m=>m.metadata.bodyRegion==="HEAD"&&
    m.metadata.imageRole!=="LOCALIZER"&&m.metadata.imageRole!=="DERIVED"&&
    !!m.metadata.sopInstanceUid&&!!m.metadata.seriesUid&&
    (m.metadata.numberOfFrames===null||m.metadata.numberOfFrames===1)&&files.has(m.id)),[series,files]);
 useEffect(()=>{
  rev.current++;ctrl.current?.abort();setResult(null);setStatus("");setError("");setBusy(false);
  setAuthorized(false);
  return ()=>{rev.current++;ctrl.current?.abort();};
 },[series,files]);
 if(series.modality!=="CT"||series.members.some(m=>m.metadata.bodyRegion!=="HEAD"))return null;
 async function start(){
  if(!eligible||!authorized||!token||busy)return;
  const v=++rev.current;ctrl.current?.abort();const next=new AbortController();ctrl.current=next;
  setBusy(true);setResult(null);setError("");setStatus("Проверка реальной модели кровоизлияний…");
  try{
   const evidence=await runPublicIchWorker({endpoint,token},series,files,next.signal,message=>{
    if(v===rev.current&&!next.signal.aborted)setStatus(message);
   });
   if(v!==rev.current||next.signal.aborted)return;
   const uids=new Set(series.members.map(m=>m.metadata.sopInstanceUid));
   const seriesIds=new Set(series.members.map(m=>m.metadata.seriesUid));
   if(seriesIds.size!==1||evidence.seriesReviewed.some(uid=>!seriesIds.has(uid))||
      evidence.findings.some(f=>!uids.has(f.source.sopInstanceUid)||
       !seriesIds.has(f.source.seriesUid)||f.source.frameIndex!==0))
    throw Error("Находки ICH не соответствуют открытым DICOM-срезам.");
   setResult(evidence);setStatus("Настоящий ICH-инференс завершён; находки требуют врачебной проверки.");
  }catch(e){
   if(v===rev.current&&!next.signal.aborted)
    setError(e instanceof Error?e.message:"ICH не завершён.");
  }finally{if(v===rev.current)setBusy(false);}
 }
 return <section className="cs-geometry" aria-label="Автоматическая детекция внутричерепного кровоизлияния">
  <h3>ICH · настоящая модель кровоизлияний</h3>
  <p>Открытая КТ головы → SHA-256 каждого исходного DICOM → проверенный частный Linux-worker → оригинальная модель ianpan. Модель анализирует только заранее разрешённую точно совпадающую публичную серию на worker.</p>
  {!eligible&&<p role="status">Нужна единая исходная аксиальная КТ головы, 8–64 среза, с корректной геометрией и всеми файлами.</p>}
  <label>Локальный ICH-worker <input type="text" value={endpoint} disabled={busy} onChange={e=>setEndpoint(e.target.value)}/></label>
  <label>Токен worker <input type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/></label>
  <label><input type="checkbox" checked={authorized} disabled={busy} onChange={e=>setAuthorized(e.target.checked)}/>
   Подтверждаю: только разрешённая публичная обезличенная КТ, предварительно установленная на worker; не пациентское исследование.</label>
  <button type="button" disabled={!eligible||!authorized||!token||busy} onClick={()=>void start()}>
   {busy?"Настоящий ICH-инференс…":"Анализировать эту КТ головы"}
  </button>
  {busy&&<button type="button" onClick={()=>{rev.current++;ctrl.current?.abort();setBusy(false);setStatus("Отменено.");}}>Отменить</button>}
  {status&&<p role="status">{status}</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<div>
   <p><strong>Исходная модель завершена. Кандидатов: {result.findings.length}.</strong> Отсутствие кандидатов не исключает кровоизлияние.</p>
   <ul>{result.findings.map((f,i)=><li key={i}>
    <b>{f.sign} · {f.anatomy}</b> · SOP {series.members.findIndex(m=>m.metadata.sopInstanceUid===f.source.sopInstanceUid)+1} из {series.members.length};
    статус: требует подтверждения врача.
   </li>)}</ul>
   <p>Модель не прошла независимую клиническую валидацию в данном приложении.</p>
  </div>}
 </section>;
}
