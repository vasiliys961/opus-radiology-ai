"use client";
import {useCallback,useEffect,useState} from "react";

type State={ready:boolean;workstationConnected:boolean};
export default function TechnicalConnectionStatus(){
 const [state,setState]=useState<State|null>(null);
 const [issue,setIssue]=useState("");
 const [busy,setBusy]=useState(true);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  setBusy(true);setIssue("");
  try{
   const response=await fetch("/api/ai/deidentified-openrouter-review",{
    cache:"no-store",credentials:"same-origin",signal,
   });
   if(!response.ok)throw Error("Проверка локального подключения недоступна.");
   const result:unknown=await response.json();
   if(!result||typeof result!=="object"||Array.isArray(result))
    throw Error("Неверный ответ сервера.");
   const data=result as Record<string,unknown>;
   if(typeof data.enabled!=="boolean"||typeof data.workstationConnected!=="boolean")
    throw Error("Неполный ответ сервера.");
   if(!signal?.aborted)setState({ready:data.enabled,workstationConnected:data.workstationConnected});
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
   state?.workstationConnected?<p className="hub-good" role="status">Подключение для проверенных обезличенных кадров подготовлено. Перед отправкой нужны проверка изображений и ваше разрешение. Доступность моделей проверяется при запуске анализа.</p>:
   state?.ready?<p role="status">Сервер подготовлен для ручного подключения оператором. Для подключения без пароля настройте локальный сеанс проверенных кадров.</p>:
   <p role="status">Анализ обезличенных кадров не настроен на этом локальном сервере. Проверьте ключ и разрешения в инструкции по настройке.</p>}
  <p className="hub-muted">Проверяется только состояние локального сеанса. Ключи и данные изображений не показываются.</p>
  <button type="button" disabled={busy} onClick={()=>void refresh()}>Проверить снова</button>
  <a href="/guide#administrator">Инструкция по однократной настройке</a>
 </section>;
}
