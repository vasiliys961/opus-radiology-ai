"use client";
import {useEffect,useState} from "react";
import {BASIC_CATALOG,FULL_CATALOG,NOT_DEPLOYED} from "../lib/detector-deploy-plan";

type Item={id:string;title:string;size:string;requirement:string;willInstall:boolean};
type Scope={eligible:boolean;items:Item[]};
type ServiceLine={id:string;started:boolean;reason?:string};
type DeployState={
  message:string;notDeployed:string;
  minimum:{ramGib:number;freeDiskGib:number};
  basic:Scope;full:Scope;
  services?:ServiceLine[];
};
const SERVICE_NAME:Record<string,string>={
  chest_xray_six:"Рентген грудной клетки",
  chest_nodes:"Узлы средостения",
  brain_hemorrhage:"Кровоизлияние",
  lung_tumor_cln:"Опухоль лёгкого",
};
export default function DetectorDeployButton(){
  const [state,setState]=useState<DeployState|null>(null);
  const [busy,setBusy]=useState<"basic"|"full"|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const ctl=new AbortController();
    fetch("/api/detector-deploy",{cache:"no-store",signal:ctl.signal})
      .then(async r=>r.ok?r.json():Promise.reject())
      .then(setState).catch(()=>{if(!ctl.signal.aborted)setError("Проверка сервера не ответила.");});
    return ()=>ctl.abort();
  },[]);
  async function deploy(scope:"basic"|"full"){
    setBusy(scope);setError("");
    try{
      const response=await fetch("/api/detector-deploy",{
        method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({scope}),
      });
      const data=await response.json();
      setState(data);
      if(!response.ok)setError(data.message??"Закачка не начата.");
    }catch{setError("Сервер не завершил закачку.");}
    finally{setBusy(null);}
  }
  function list(fallback:readonly {id:string;title:string;size:string;requirement:string}[],live?:Item[]){
    const rows=live??fallback.map(item=>({...item,willInstall:null as boolean|null}));
    return <ul>{rows.map(item=><li key={item.id}>
      <strong>{item.title}.</strong> {item.size}. {item.requirement}.
      {item.willInstall===true?" Скачается.":item.willInstall===false?" На этом компьютере не скачается.":""}
    </li>)}</ul>;
  }
  return <section aria-label="Развернуть детекторы">
    <h3>Развернуть детекторы</h3>
    <p>После сверки весов приложение запускает те службы, для которых на сервере уже стоит нужная программа. Минимум: Linux, {state?.minimum.ramGib??16} ГБ памяти, {state?.minimum.freeDiskGib??30} ГБ свободно.</p>
    {state&&<p role="status">{state.message}</p>}
    {state?.services?.length ? <ul>{state.services.map(item=><li key={item.id}>
      {SERVICE_NAME[item.id]??item.id}: {item.started?"служба отвечает.":"служба не запустилась."} {item.reason??""}
    </li>)}</ul> : null}
    {error&&<p role="alert">{error}</p>}
    <div className="deploy-block">
      <h3>Первая кнопка</h3>
      {list(BASIC_CATALOG,state?.basic.items)}
      <button type="button" disabled={!state?.basic.eligible||busy!==null} onClick={()=>void deploy("basic")}>
        {busy==="basic"?"Скачиваем вес…":"Развернуть рентген грудной клетки"}
      </button>
    </div>
    <div className="deploy-block">
      <h3>Вторая кнопка</h3>
      {list(FULL_CATALOG,state?.full.items)}
      <p>{NOT_DEPLOYED}</p>
      <button type="button" disabled={!state?.full.eligible||busy!==null} onClick={()=>void deploy("full")}>
        {busy==="full"?"Скачиваем веса…":"Развернуть все возможные"}
      </button>
    </div>
  </section>;
}
