"use client";
import {useState} from "react";
import {ILD_FEATURES,interpretIldObservations,type IldFeature,type Distribution,type IldPatternSummary} from "../lib/ild-pattern-engine";
const labels:Record<IldFeature,string>={
 ground_glass:"Матовое стекло",reticulation:"Ретикуляция",honeycombing:"Сотовое лёгкое",
 traction_bronchiectasis:"Тракционные бронхоэктазы",consolidation:"Консолидация",
 mosaic_attenuation:"Мозаичная плотность",centrilobular_nodules:"Центрилобулярные узелки",
 perilymphatic_nodules:"Перилимфатические узелки",subpleural_sparing:"Субплевральное сохранение"
};
const distributionOptions:Record<Distribution,string>={
 unknown:"Не определено",basal_subpleural:"Базально-субплевральное",
 peribronchovascular:"Перибронховаскулярное",upper_mid:"Верхние/средние отделы",
 diffuse:"Диффузное",random:"Без чёткой закономерности"
};
export default function IldPatternResearch({isChestCT}:{isChestCT:boolean}){
 const [features,setFeatures]=useState<IldFeature[]>([]);
 const [distribution,setDistribution]=useState<Distribution>("unknown");
 const [slices,setSlices]=useState("");
 const [confirmed,setConfirmed]=useState(false);
 const [result,setResult]=useState<IldPatternSummary|null>(null);
 const [error,setError]=useState("");
 function reset(){setResult(null);setError("");}
 return <section className="cs-geometry" aria-label="Морфологический анализ интерстициальных изменений">
 <h3>ILD Pattern Engine · врачебная морфология HRCT</h3>
 <p>Отметьте <strong>только признаки, подтверждённые врачом на исходных срезах</strong>.
 Данные здесь не определяются автоматически по КТ. Внешним AI-сервисам изображения не передаются.</p>
 {!isChestCT&&<p role="alert">Выбрана не подтверждённая КТ грудной клетки: формирование заключения заблокировано.</p>}
 <fieldset disabled={!isChestCT} style={{border:0,padding:0,margin:0}}>
 <legend>Визуально подтверждённые признаки</legend>
 {ILD_FEATURES.map(k=><label key={k} style={{display:"block",margin:"5px 0"}}>
 <input type="checkbox" checked={features.includes(k)} onChange={e=>{
 setFeatures(old=>e.target.checked?[...old,k]:old.filter(x=>x!==k));reset();
 }}/>{" "}{labels[k]}</label>)}
 <label style={{display:"block",marginTop:8}}>Распределение
 <select value={distribution} onChange={e=>{setDistribution(e.target.value as Distribution);reset();}}
 style={{display:"block",width:"100%",maxWidth:340,marginTop:4}}>
 {Object.entries(distributionOptions).map(([k,name])=><option key={k} value={k}>{name}</option>)}
 </select></label>
 <label style={{display:"block",marginTop:8}}>Ссылки на исходные срезы (номера, через запятую)
 <input value={slices} onChange={e=>{setSlices(e.target.value);reset();}} placeholder="Например, 27, 46, 83"
 style={{display:"block",width:"100%",maxWidth:340}} maxLength={512}/></label>
 <label style={{display:"block",marginTop:8}}><input type="checkbox" checked={confirmed}
 onChange={e=>{setConfirmed(e.target.checked);reset();}}/> Подтверждаю ручную оценку исходных КТ-срезов</label>
 <button type="button" onClick={()=>{
 try{const refs=slices.split(",").map(s=>s.trim()).filter(Boolean);
 if(refs.some(s=>!/^[0-9]{1,6}$/.test(s)))throw Error("Номера срезов должны содержать только цифры.");
 setResult(interpretIldObservations({features,distribution,axialSourceRefs:refs,readerConfirmed:confirmed}));
 setError("");
 }catch(e){setResult(null);setError(e instanceof Error?e.message:"Ошибка обработки.");}
 }}>Сопоставить морфологические комплексы</button>
 </fieldset>
 {error&&<p role="alert">{error}</p>}
 {result&&<div role="status" style={{marginTop:10}}>
 {result.status==="insufficient_evidence"?
 <p>Недостаточно подтверждённых данных для даже описательного дифференциального ряда.</p>:
 <><h4>Описательные паттерны — исследовательская гипотеза</h4>
 {result.candidates.map(c=><div key={c.name}><strong>{c.name}</strong>
 <p>Поддерживающие отмеченные признаки: {c.support.map(k=>labels[k]).join(", ")}.</p><p>{c.caveat}</p></div>)}</>}
 <p><strong>Ограничения и недостающие данные:</strong> {result.missing.join(" ")}</p>
 <p>Автоматического распознавания фиброза, нозологического диагноза, точности модели или оценки вероятностей здесь нет. Врач проверяет исходную HRCT.</p>
 </div>}
 </section>;
}
