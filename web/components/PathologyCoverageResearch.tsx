"use client";

import {useEffect,useMemo,useState} from "react";

type Status="real_case_measured"|"real_trial_running"|"real_checkpoint_candidate"|"license_blocked"|"weights_unverified";
type Entry={id:string;modality:string;anatomy:string;pathology:string;status:Status;weights:string;source:string;reference:string;restriction:string;priority:number;next:string};
type Catalog={schema:"opus-clinically-prioritized-detector-coverage/v1";asOf:string;entries:Entry[]};
const statuses:Record<Status,string>={
 real_case_measured:"Инференс на публичном исследовании",
 real_trial_running:"Исследовательский запуск, результат не подтверждён",
 real_checkpoint_candidate:"Веса-кандидаты, результат ещё не получен",
 license_blocked:"Ограничено лицензией",
 weights_unverified:"Веса/инференс пока не проверены"
};
const regionLabels:Record<string,string>={
 brain:"Головной мозг",thorax:"Грудная клетка",abdomen:"Брюшная полость",
 pelvis:"Таз",spine:"Позвоночник",hip:"Тазобедренные суставы",knee:"Коленные суставы",
 heart:"Сердце",vascular:"Сосуды",breast:"Молочная железа",
 retina:"Сетчатка",histology:"Патоморфология"
};
const isStatus=(s:unknown):s is Status=>typeof s==="string"&&Object.hasOwn(statuses,s);
function isEntry(item:unknown):item is Entry{
 if(!item||typeof item!=="object")return false;
 const x=item as Partial<Entry>;
 return typeof x.id==="string"&&x.id.length>0&&typeof x.anatomy==="string"&&
  typeof x.modality==="string"&&typeof x.pathology==="string"&&
  typeof x.source==="string"&&x.source.startsWith("https://")&&
  typeof x.reference==="string"&&typeof x.restriction==="string"&&
  typeof x.weights==="string"&&typeof x.next==="string"&&isStatus(x.status);
}
export function validateCoverage(v:unknown):Catalog{
 if(!v||typeof v!=="object")throw Error("Неверный формат каталога.");
 const x=v as Partial<Catalog>;
 if(x.schema!=="opus-clinically-prioritized-detector-coverage/v1"||
    typeof x.asOf!=="string"||!Array.isArray(x.entries)||
    x.entries.length<1||x.entries.length>200||!x.entries.every(isEntry))
  throw Error("Каталог исследовательских задач не прошёл проверку.");
 const ids=new Set(x.entries.map(e=>e.id));
 if(ids.size!==x.entries.length)throw Error("Повторяющиеся идентификаторы патологий.");
 return x as Catalog;
}

export default function PathologyCoverageResearch(){
 const [catalog,setCatalog]=useState<Catalog|null>(null);
 const [error,setError]=useState("");
 const [region,setRegion]=useState("all");
 const [state,setState]=useState<Status|"all">("all");

 useEffect(()=>{
  let live=true;
  async function load(){
   try{
    const response=await fetch("/examples/clinical-pathology-coverage.json",{cache:"no-store"});
    if(!response.ok)throw Error("Локальный каталог покрытия недоступен.");
    const raw=await response.text();
    if(raw.length>300*1024)throw Error("Каталог превышает установленный размер.");
    const validated=validateCoverage(JSON.parse(raw));
    if(live)setCatalog(validated);
   }catch(e){if(live)setError(e instanceof Error?e.message:"Ошибка загрузки каталога.");}
  }
  void load();
  return ()=>{live=false;};
 },[]);
 const regions=useMemo(()=>[...new Set(catalog?.entries.map(x=>x.anatomy)??[])].sort(),[catalog]);
 const visible=useMemo(()=>(catalog?.entries??[]).filter(x=>
  (region==="all"||region===x.anatomy)&&(state==="all"||state===x.status)),[catalog,region,state]);
 const measured=catalog?.entries.filter(x=>x.status==="real_case_measured").length??0;
 const distinct=catalog?new Set(catalog.entries.map(x=>x.anatomy+"|"+x.pathology)).size:0;
 return <section className="cs-geometry" aria-label="Карта реального исследовательского покрытия патологий">
  <div className="cs-intro">
   <div><div className="cs-kicker">OPUS RADIOLOGY / EVIDENCE COVERAGE</div>
    <h1>Покрытие патологий</h1>
    <p>Учитываются отдельные диагностические задачи, а не число подключённых нейросетей или анатомических масок.</p></div>
  </div>
  <p role="alert"><strong>Ни одна строка каталога не разрешает клиническое использование.</strong> «Инференс выполнен» означает лишь один или несколько исследовательских примеров, возможно с пересечением обучения. Это не установленная чувствительность, специфичность или способность исключить патологию на вашем исследовании.</p>
  {error&&<p role="alert">{error}</p>}
  {!catalog&&!error&&<p>Чтение локального каталога…</p>}
  {catalog&&<>
   <div style={{display:"flex",flexWrap:"wrap",gap:12,margin:"12px 0"}}>
    <div style={{border:"1px solid #789085",padding:12,borderRadius:9}}>
     <strong>{catalog.entries.length}</strong><div>Исследовательских маршрутов/кандидатов</div>
    </div>
    <div style={{border:"1px solid #789085",padding:12,borderRadius:9}}>
     <strong>{distinct}</strong><div>Различных задач (область × патология)</div>
    </div>
    <div style={{border:"1px solid #789085",padding:12,borderRadius:9}}>
     <strong>{measured}</strong><div>Записей с исследовательским инференсом</div>
    </div>
    <div style={{border:"1px solid #789085",padding:12,borderRadius:9}}>
     <strong>0</strong><div>Заявленных клинически валидированных маршрутов</div>
    </div>
   </div>
   <p><small>Локальный каталог на {catalog.asOf}. Не содержит DICOM, имён пациентов, ключей или результатов текущей серии.</small></p>
   <div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"center"}}>
    <label>Область{" "}
     <select value={region} onChange={e=>setRegion(e.target.value)}>
      <option value="all">Все локализации</option>
      {regions.map(s=><option value={s} key={s}>{regionLabels[s]??s}</option>)}
     </select>
    </label>
    <label>Доказательность{" "}
     <select value={state} onChange={e=>setState(e.target.value as Status|"all")}>
      <option value="all">Все состояния</option>
      {(Object.keys(statuses) as Status[]).map(s=><option value={s} key={s}>{statuses[s]}</option>)}
     </select>
    </label>
   </div>
   <p>Отображено: <strong>{visible.length}</strong>. На уровне пациента достоверность не оценена.</p>
   <div style={{display:"grid",gap:12,marginTop:12}}>
    {visible.map(entry=><article key={entry.id}
      style={{border:"1px solid #8c9b95",borderRadius:10,padding:12}}>
     <h3 style={{margin:"0 0 6px"}}>{entry.pathology}</h3>
     <p><strong>{regionLabels[entry.anatomy]??entry.anatomy}</strong>{" · "}{entry.modality}
      {" · "}<strong>{statuses[entry.status]}</strong></p>
     <p>Модель/веса: {entry.weights}</p>
     <p>Эталон: {entry.reference}</p>
     <p><strong>Ограничение:</strong> {entry.restriction}</p>
     <details><summary>Следующий клинически значимый шаг</summary>
      <p>{entry.next}</p>
      <a href={entry.source} rel="noopener noreferrer" target="_blank">Публикация или источник модели</a>
     </details>
    </article>)}
   </div>
   {visible.length===0&&<p>В выбранной области нет зарегистрированных задач с заданным статусом.</p>}
  </>}
 </section>;
}
