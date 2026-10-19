"use client";
import {useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {interpretThoracicMasses,THORACIC_MASS_KINDS,
 type ThoracicMassKind,type ThoracicCompartment,
 type ThoracicFindingInput,type ThoracicMassWorklist} from "../lib/thoracic-mass-worklist";

const compartments:Record<ThoracicMassKind,readonly ThoracicCompartment[]>={
 pulmonary_nodule:["lung"],pulmonary_mass:["lung"],
 mediastinal_mass:["anterior_mediastinum","middle_mediastinum","posterior_mediastinum"],
 mediastinal_lymph_node:["anterior_mediastinum","middle_mediastinum","posterior_mediastinum"],
 hilar_lymph_node:["hilum"],pleural_mass:["pleura"],chest_wall_mass:["chest_wall"],
};
const anatomy:Record<ThoracicCompartment,string>={
 lung:"Лёгкое",anterior_mediastinum:"Переднее средостение",
 middle_mediastinum:"Среднее средостение",
 posterior_mediastinum:"Заднее средостение",hilum:"Корень лёгкого",
 pleura:"Плевра",chest_wall:"Грудная стенка",
};
const locations={right:"Справа",left:"Слева",midline:"По средней линии",unknown:"Не определена"} as const;
const densities={
 soft_tissue:"Мягкотканная",ground_glass:"Матового стекла",mixed:"Смешанная",
 fat:"Жировая",calcified:"Кальцинаты",unknown:"Не определена",
} as const;
export default function ThoracicMassResearch({series}:{series:DicomSeries|null}){
 const [kind,setKind]=useState<ThoracicMassKind>("mediastinal_lymph_node");
 const [compartment,setCompartment]=useState<ThoracicCompartment>("middle_mediastinum");
 const [side,setSide]=useState<ThoracicFindingInput["side"]>("unknown");
 const [slice,setSlice]=useState("");
 const [longest,setLongest]=useState("");
 const [shortAxis,setShortAxis]=useState("");
 const [contrast,setContrast]=useState<ThoracicFindingInput["contrast"]>("unknown");
 const [attenuation,setAttenuation]=useState<ThoracicFindingInput["attenuation"]>("unknown");
 const [confirmed,setConfirmed]=useState(false);
 const [observations,setObservations]=useState<ThoracicFindingInput[]>([]);
 const [error,setError]=useState("");
 const [report,setReport]=useState<ThoracicMassWorklist|null>(null);
 const eligible=!!series&&series.modality==="CT"&&series.members.length>0&&
   series.members.every(m=>m.metadata.modality==="CT"&&m.metadata.bodyRegion==="CHEST");
 function reset(){setReport(null);setError("");}
 function add(){
   if(!eligible||!series)return;
   try{
     const ordinal=Number(slice),source=series.members[ordinal-1];
     if(!slice||!source||!Number.isSafeInteger(ordinal))throw Error("Укажите реальный срез этой КТ.");
     const value:ThoracicFindingInput={
       kind,compartment,side,sliceOrdinal:ordinal,localSourceMemberId:source.id,
       origin:"physician_annotation",readerConfirmed:confirmed as true,contrast,attenuation,
       longestAxialMm:longest.trim()?Number(longest):null,
       shortAxisMm:shortAxis.trim()?Number(shortAxis):null,
     };
     interpretThoracicMasses(series,[value]);
     setObservations(current=>[...current,value].slice(0,40));
     reset();setConfirmed(false);setSlice("");setLongest("");setShortAxis("");
   }catch(e){setError(e instanceof Error?e.message:"Недопустимая локальная находка.");}
 }
 function review(){
   if(!eligible||!series)return;
   try{setReport(interpretThoracicMasses(series,observations));setError("");}
   catch{setReport(null);setError("Срезы или исходная серия изменились; откройте исходные изображения повторно.");}
 }
 return <section className="cs-geometry" aria-label="Внутригрудные образования — исходная КТ">
   <h3>КТ грудной клетки · образования и лимфоузлы</h3>
   <p>Отдельная регистрация лёгочных узлов и масс, образований средостения,
     лимфоузлов корней, плевральных и пристеночных очагов.
     Это <strong>врачебный обзор исходных DICOM</strong>, не автоматическое обнаружение опухоли.</p>
   {!eligible&&<p role="status">Выберите однородную серию КТ грудной клетки для привязки к настоящим срезам.</p>}
   <fieldset disabled={!eligible} style={{border:0,padding:0,margin:0}}>
     <label>Тип находки
       <select value={kind} onChange={e=>{
         const k=e.target.value as ThoracicMassKind;
         setKind(k);setCompartment(compartments[k][0]);reset();
       }}>{(Object.keys(THORACIC_MASS_KINDS) as ThoracicMassKind[]).map(k=>
         <option key={k} value={k}>{THORACIC_MASS_KINDS[k]}</option>)}</select>
     </label>
     <label>Локализация
       <select value={compartment} onChange={e=>{setCompartment(e.target.value as ThoracicCompartment);reset();}}>
         {compartments[kind].map(k=><option key={k} value={k}>{anatomy[k]}</option>)}
       </select>
     </label>
     <label>Сторона
       <select value={side} onChange={e=>{setSide(e.target.value as typeof side);reset();}}>
         {(Object.keys(locations) as ThoracicFindingInput["side"][]).map(k=>
           <option key={k} value={k}>{locations[k]}</option>)}
       </select>
     </label>
     <label>Срез исходной КТ (1–{series?.members.length??0})
       <input type="number" min="1" max={series?.members.length??1}
         value={slice} onChange={e=>{setSlice(e.target.value);reset();}}/>
     </label>
     <label>Наибольший аксиальный размер, мм
       <input type="number" min="0.1" max="500" step="0.1"
         value={longest} onChange={e=>{setLongest(e.target.value);reset();}}/>
     </label>
     <label>Короткая ось, мм — важна для лимфоузлов
       <input type="number" min="0.1" max="500" step="0.1"
         value={shortAxis} onChange={e=>{setShortAxis(e.target.value);reset();}}/>
     </label>
     <label>Контраст
       <select value={contrast} onChange={e=>{setContrast(e.target.value as typeof contrast);reset();}}>
         <option value="unknown">Не определён</option>
         <option value="noncontrast">Без контраста</option>
         <option value="contrast">Контрастная КТ</option>
       </select>
     </label>
     <label>Видимая структура
       <select value={attenuation} onChange={e=>{setAttenuation(e.target.value as typeof attenuation);reset();}}>
         {(Object.keys(densities) as ThoracicFindingInput["attenuation"][]).map(k=>
           <option key={k} value={k}>{densities[k]}</option>)}
       </select>
     </label>
     <label><input type="checkbox" checked={confirmed}
       onChange={e=>setConfirmed(e.target.checked)}/>
       Я лично просмотрел этот исходный DICOM-срез; введённые измерения — ручные.</label>
     <button type="button" disabled={!confirmed||observations.length>=40} onClick={add}>
       Записать находку на исходной КТ
     </button>
   </fieldset>
   {observations.length>0&&<div>
     <p>Привязанных наблюдений: {observations.length}</p>
     <ul>{observations.map((o,i)=><li key={i}>
       {THORACIC_MASS_KINDS[o.kind]} · срез {o.sliceOrdinal},
       {" "}{o.longestAxialMm??"?"} мм
       <button type="button" onClick={()=>{
         setObservations(old=>old.filter((_,j)=>j!==i));reset();
       }}>Удалить</button>
     </li>)}</ul>
     <button type="button" onClick={review}>Сформировать локальный обзор образований</button>
   </div>}
   {error&&<p role="alert">{error}</p>}
   {report&&<div role="status">
     <h4>Врачебные наблюдения · {report.findings.length}</h4>
     {report.findings.map((f,i)=><article key={i}>
       <strong>{THORACIC_MASS_KINDS[f.kind]}</strong> · {anatomy[f.compartment]} · {locations[f.side]}
       <p>Исходный срез {f.sourceSliceOrdinal}.
         {" "}Длинная ось {f.longestAxialMm??"не измерена"} мм;
         короткая ось {f.shortAxisMm??"не измерена"} мм.</p>
       <small>{f.caveats.join(" ")}</small>
     </article>)}
     <p><strong>Это не заключение:</strong> метастазы, рак и отсутствие иных образований
       не установлены. Нет обученной модели, 3D-маски и независимого эталона.
       Исходные UID и имена файлов не включены в обзор.</p>
   </div>}
 </section>;
}
