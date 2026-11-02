"use client";
import {useCallback,useEffect,useState} from "react";

type State={ready:boolean;workstationConnected:boolean;status?:
  "ready"|"not-development"|"missing-provider"|"not-approved"};
export default function TechnicalConnectionStatus(){
 const [state,setState]=useState<State|null>(null);
 const [issue,setIssue]=useState("");
 const [busy,setBusy]=useState(true);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  setBusy(true);setIssue("");
  try{
   const response=await fetch("/api/ai/volume-operator-session",{
    cache:"no-store",credentials:"same-origin",signal,
   });
   if(!response.ok)throw Error("Проверка локального подключения недоступна.");
   const result:unknown=await response.json();
   if(!result||typeof result!=="object"||Array.isArray(result))
    throw Error("Неверный ответ сервера.");
   const data=result as Record<string,unknown>;
   if(typeof data.ready!=="boolean"||typeof data.workstationConnected!=="boolean")
    throw Error("Неполный ответ сервера.");
   if(!signal?.aborted)setState({ready:data.ready,workstationConnected:data.workstationConnected,
     status:typeof data.status==="string"?data.status as State["status"]:undefined});
  }catch(e){
   if(!signal?.aborted){setState(null);setIssue(e instanceof Error?e.message:"Проверка недоступна.");}
  }finally{if(!signal?.aborted)setBusy(false);}
 },[]);
 useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);
  return()=>controller.abort();},[refresh]);
 return <section className="hub-panel" aria-label="Подключение Gemini и Opus">
  <h2>Gemini / Opus — подключение</h2>
  {busy?<p role="status">Проверяем локальное рабочее место…</p>:
   issue?<p role="status">{issue}</p>:
   state?.workstationConnected?<p className="hub-good" role="status">Локальное подключение подготовлено. Доступность самого OpenRouter проверяется при запуске анализа.</p>:
   state?.ready?<p role="status">Локальный сервер подготовлен. Проверьте подключение повторно.</p>:
   state?.status==="missing-provider"?<p role="status">OpenRouter: ключ не найден в настройках этого сервера.</p>:
   state?.status==="not-approved"?<p role="status">Облачная передача публичных обезличенных исследований не разрешена в настройках.</p>:
   state?.status==="not-development"?<p role="status">Этот автоматический режим работает только при локальном npm run dev.</p>:
   <p role="status">Локальный облачный анализ недоступен. Просмотр DICOM продолжает работать.</p>}
  <p className="hub-muted">Проверяется только состояние локального сеанса. Ключи и данные изображений не показываются.</p>
  <button type="button" disabled={busy} onClick={()=>void refresh()}>Проверить снова</button>
  <a href="/guide#administrator">Инструкция по однократной настройке</a>
 </section>;
}
