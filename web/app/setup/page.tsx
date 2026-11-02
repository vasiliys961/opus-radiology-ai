"use client";
import {useEffect,useState} from "react";

/** Operator-only connection. The clinical workspace never asks for credentials. */
export default function WorkstationSetup(){
 const [token,setToken]=useState("");
 const [ready,setReady]=useState<boolean|null>(null);
 const [configured,setConfigured]=useState(false);
 const [message,setMessage]=useState("");
 useEffect(()=>{
   void fetch("/api/ai/volume-operator-session",{cache:"no-store"})
     .then(async res=>res.ok?await res.json():null)
     .then(data=>{
       setReady(data?.workstationConnected===true);
       setConfigured(data?.ready===true);
     }).catch(()=>setReady(false));
 },[]);
 async function activate(){
   setMessage("");
   const res=await fetch("/api/ai/volume-operator-session",{
     method:"POST",cache:"no-store",credentials:"same-origin",
     headers:{"X-Opus-Local-Operator-Token":token},
   }).catch(()=>null);
   setToken("");
   if(res?.ok){setReady(true);setMessage("Рабочее место подключено.");}
   else setMessage("Не удалось подключиться. Проверьте настройки локального сервера.");
 }
 return <main style={{maxWidth:560,margin:"8vh auto",padding:24,fontFamily:"system-ui"}}>
   <h1>Подключение рабочего места</h1>
   <p>Только для администратора. Врач работает в обычном просмотрщике без технических настроек.</p>
   {ready===true?<p role="status">Рабочее место подключено. <a href="/viewer">Открыть просмотр снимков</a></p>:
    configured?<div><label>Код администратора
      <input type="password" value={token} autoComplete="off"
        onChange={e=>setToken(e.target.value)} style={{display:"block",width:"100%",padding:10,marginTop:8}}/>
      </label><button type="button" disabled={!token.trim()} onClick={()=>void activate()}
        style={{marginTop:12,padding:12}}>Подключить</button></div>:
    <p role="status">Автоматический облачный анализ не настроен. Нужны разрешённый исследовательский режим и секреты сервера.</p>}
   {message&&<p role="status">{message}</p>}
   <p><a href="/viewer">Вернуться к исследованию</a></p>
 </main>;
}
