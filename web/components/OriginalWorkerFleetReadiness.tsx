"use client";
/** Read-only actual Linux worker/pretrained-weight health; no DICOM leaves browser. */
import {useEffect,useRef,useState} from "react";

const IDS=[
 ["chest_nodules","КТ · узлы лёгких"],
 ["chest_effusion","КТ · плевральный/перикардиальный выпот"],
 ["chest_pe","КТ-ангиография · ТЭЛА"],
 ["chest_nodes","КТ · лимфоузлы средостения"],
 ["abdomen","КТ живота · кисты, очаги печени, поджелудочная"],
 ["brain_hemorrhage","КТ головы · кровоизлияние"],
 ["brain_wmh","МРТ · WMH"],
 ["brain_stroke","МРТ · ишемические очаги"],
 ["brain_glioma","МРТ · глиома"],
 ["chest_xray_six","CR/DX · шесть NIH TorchXRayVision признаков"],
] as const;
const STATES={
 ready:"Оригинальные веса проверены, worker отвечает",
 not_configured:"Не подключён к серверной проверке (не означает отсутствие весов)",
 unreachable:"Нет ответа локального worker",
 original_model_unverified:"Worker отвечает, но оригинальная модель не подтверждена",
} as const;
type State=keyof typeof STATES;
type Entry={id:string;status:State;researchOnly:true;clinicalValidation:false};
export default function OriginalWorkerFleetReadiness(){
 const [entries,setEntries]=useState<Entry[]|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const abort=useRef<AbortController|null>(null);
 async function refresh(){
  abort.current?.abort();
  const ctl=new AbortController();abort.current=ctl;
  setLoading(true);setError("");
  try{
   const response=await fetch("/api/local-model-readiness",{
    method:"GET",cache:"no-store",credentials:"same-origin",
    signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(9500)]),
   });
   if(!response.ok)throw Error("Сервер проверки моделей недоступен в этом режиме.");
   const value:unknown=await response.json();
   if(!value||typeof value!=="object"||Array.isArray(value))
    throw Error("Неверный паспорт готовности моделей.");
   const x=value as Record<string,unknown>;
   if(x.schema!=="opus-original-worker-fleet/v1"||
      x.patientMode!==false||x.clinicalValidation!==false||
      !Array.isArray(x.entries)||x.entries.length!==IDS.length||
      !x.entries.every((v:unknown,i:number)=>{
       if(!v||typeof v!=="object"||Array.isArray(v))return false;
       const s=v as Record<string,unknown>;
       return s.id===IDS[i][0]&&
        Object.prototype.hasOwnProperty.call(STATES,String(s.status))&&
        s.researchOnly===true&&s.clinicalValidation===false;
      }))throw Error("В ответе нет подтверждения отдельных оригинальных моделей.");
   if(!ctl.signal.aborted)setEntries(x.entries as Entry[]);
  }catch(e){
   if(!ctl.signal.aborted){
    setEntries(null);
    setError(e instanceof Error?e.message:"Не удалось проверить модели.");
   }
  }finally{if(!ctl.signal.aborted)setLoading(false);}
 }
 useEffect(()=>{
  void refresh();
  return()=>{abort.current?.abort();};
 },[]);
 const ready=entries?.filter(x=>x.status==="ready").length??0;
 return <section aria-label="Готовность оригинальных моделей для КТ МРТ и рентгенографии">
  <details>
   <summary>
    Настоящая готовность Linux-детекторов: {loading?"проверяем…":
      entries?ready+" из "+entries.length+" направлений":"проверка недоступна"}
   </summary>
   <p>Это ПРОВЕРКА установленных оригинальных моделей и отвечающих исполнителей,
     а не доказательство клинической точности. Серверу не передаются DICOM,
     сведения пациента или изображения.</p>
   {entries&&IDS.map(([id,label],i)=><p key={id}>
     <strong>{label}</strong>: {STATES[entries[i].status]}
   </p>)}
   {error&&<p role="status">{error}</p>}
   <button type="button" disabled={loading} onClick={()=>void refresh()}>
     {loading?"Проверяем реальные модели…":"Обновить состояние"}
   </button>
   <p>Настройка прав, весов и сервисов проводится администратором
     один раз на приватном Linux-сервере. Врач не вводит worker-токены.
     Режим использования пациентских исследований пока не подтверждён.</p>
  </details>
 </section>;
}
