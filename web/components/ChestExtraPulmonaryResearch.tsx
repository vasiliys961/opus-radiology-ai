"use client";
import {useState} from "react";
import {CHEST_FINDINGS,interpretChestObservations,type ChestRegion,type ChestFinding,type ChestReport,type ChestObservation} from "../lib/chest-extra-pulmonary";
const regions:Record<ChestRegion,string>={
 mediastinum:"Средостение и лимфоузлы",heart:"Сердце и перикард",
 great_vessels:"Крупные сосуды",pleura:"Плевра",bones:"Рёбра, грудина, кости",
 spine:"Грудной отдел позвоночника"
};
const names:Record<ChestFinding,string>={
 mediastinal_lymph_nodes:"Медиастинальные лимфоузлы",hilar_lymph_nodes:"Лимфоузлы корней",
 mediastinal_mass:"Образование средостения",pneumomediastinum:"Пневмомедиастинум",
 cardiomegaly:"Увеличение размеров сердца",pericardial_effusion:"Выпот в перикарде",
 coronary_calcification:"Кальцификация коронарных артерий",
 pericardial_calcification:"Кальциноз перикарда",aortic_dilatation:"Дилатация аорты",
 aortic_calcification:"Кальциноз аорты",pulmonary_artery_enlargement:"Расширение лёгочной артерии",
 pleural_effusion:"Плевральный выпот",pleural_thickening:"Утолщение плевры",pneumothorax:"Пневмоторакс",
 rib_fracture:"Перелом ребра",bone_lesion:"Очаговое изменение кости",
 sternal_lesion:"Изменение грудины",vertebral_compression:"Компрессионная деформация позвонка",
 vertebral_lesion:"Очаговое изменение позвонка",degenerative_changes:"Дегенеративные изменения"
};
export default function ChestExtraPulmonaryResearch({isChestCT}:{isChestCT:boolean}){
 const [region,setRegion]=useState<ChestRegion>("mediastinum");
 const [finding,setFinding]=useState<ChestFinding>(CHEST_FINDINGS.mediastinum[0]);
 const [slice,setSlice]=useState("");const [size,setSize]=useState("");
 const [contrast,setContrast]=useState<ChestObservation["contrast"]>("unknown");
 const [observations,setObservations]=useState<ChestObservation[]>([]);
 const [report,setReport]=useState<ChestReport|null>(null);
 const [error,setError]=useState("");
 function reset(){setReport(null);setError("");}
 return <section className="cs-geometry" aria-label="Внелёгочные структуры грудной клетки">
 <h3>КТ грудной клетки · средостение, сердце, сосуды и скелет</h3>
 <p>Врачебная регистрация находок на исходных срезах. Пока это не автоматическая детекция.</p>
 {!isChestCT&&<p role="alert">Для добавления находок выберите подтверждённую КТ грудной клетки.</p>}
 <fieldset disabled={!isChestCT} style={{border:0,padding:0,margin:0}}>
 <label>Анатомическая область <select value={region} onChange={e=>{
 const next=e.target.value as ChestRegion;setRegion(next);setFinding(CHEST_FINDINGS[next][0]);reset();
 }}>{(Object.keys(regions) as ChestRegion[]).map(r=><option key={r} value={r}>{regions[r]}</option>)}</select></label>
 <label style={{display:"block",marginTop:6}}>Морфологическая находка <select value={finding} onChange={e=>{setFinding(e.target.value as ChestFinding);reset();}}>
 {CHEST_FINDINGS[region].map(f=><option value={f} key={f}>{names[f]}</option>)}</select></label>
 <label style={{display:"block",marginTop:6}}>Номер исходного среза <input type="number" min="1" max="100000" value={slice} onChange={e=>{setSlice(e.target.value);reset();}} style={{width:100}}/></label>
 <label style={{display:"block",marginTop:6}}>Размер, мм (если измерен) <input type="number" min="0.1" max="500" step="0.1" value={size} onChange={e=>{setSize(e.target.value);reset();}} style={{width:100}}/></label>
 <label style={{display:"block",marginTop:6}}>Тип КТ <select value={contrast} onChange={e=>{setContrast(e.target.value as ChestObservation["contrast"]);reset();}}>
 <option value="unknown">Не определён</option><option value="noncontrast">Без контраста</option><option value="contrast">С внутривенным контрастом</option>
 </select></label>
 <button type="button" onClick={()=>{
 try{const number=Number(slice);
 if(!slice||!Number.isSafeInteger(number)||number<1)throw Error("Укажите номер исходного среза.");
 const measurement=size?Number(size):undefined;
 const observation:ChestObservation={region,finding,slice:number,readerConfirmed:true,contrast,measurementMm:measurement};
 interpretChestObservations([observation]);
 setObservations(prev=>[...prev,observation]);reset();
 }catch(e){setError(e instanceof Error?e.message:"Ошибка регистрации находки.");}
 }}>Добавить подтверждённую находку</button>
 </fieldset>
 {observations.length>0&&<><p>Зарегистрировано наблюдений: {observations.length}</p>
 <ul>{observations.map((o,i)=><li key={i}>{regions[o.region]} · {names[o.finding]} · срез {o.slice}
 <button type="button" onClick={()=>{setObservations(prev=>prev.filter((_,j)=>j!==i));reset();}}>Удалить</button></li>)}</ul>
 <button type="button" onClick={()=>{try{setReport(interpretChestObservations(observations));setError("");}catch(e){setError(String(e));}}}>Сформировать структурированный обзор</button></>}
 {error&&<p role="alert">{error}</p>}
 {report&&<div role="status"><h4>Структурированный исследовательский обзор</h4>
 {report.evidence.map((x,i)=><div key={i}><strong>{regions[x.region]}: {names[x.finding]}</strong>
 <p>Исходный срез {x.slice}{x.measurementMm?"; размер "+x.measurementMm+" мм":""}</p>
 {x.limitations.map((note,j)=><p key={j}>{note}</p>)}</div>)}
 <p><strong>Ограничения:</strong> {report.missing.join(" ")} Информация требует просмотра врачом исходных изображений. Это не клинически валидированный диагноз.</p></div>}
 </section>;
}
