"use client";

import {useState} from "react";
import {parseLongCIUExpertReference,type LongCIUExpertReference} from "../lib/ild-longciu-reference";

export default function IldGgoExpertResearch({isChestCT}:{isChestCT:boolean}){
 const [report,setReport]=useState<LongCIUExpertReference|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 return <section className="cs-geometry" aria-label="HRCT интерстициальных изменений · матовое стекло и консолидация">
  <h3>Интерстициальные паттерны HRCT · GGO и консолидация</h3>
  <p>Исследовательский модуль для двух морфологических признаков: матового стекла
    и консолидации. Эти изменения неспецифичны; по ним нельзя автоматически
    установить идиопатический лёгочный фиброз, UIP или другое ИЗЛ.</p>
  {!isChestCT&&<p role="note">Для сопоставления с текущим исследованием потребуется
     КТ грудной клетки. Числа ниже относятся к отдельному открытому датасету,
     а не к загруженному пациенту.</p>}
  <button type="button" disabled={loading} onClick={async()=>{
    setLoading(true);setError("");setReport(null);
    try{
      const r=await fetch("/examples/longciu-real-ild-ggo-expert-test40-run-38753711714.json",
        {cache:"no-store"});
      if(!r.ok)throw Error("Исходный экспертный эталон LongCIU недоступен.");
      const original=await r.text();
      setReport(parseLongCIUExpertReference(original));
    }catch(e){setError(e instanceof Error?e.message:"Ошибка исследования GGO.");}
    finally{setLoading(false);}
  }}>{loading?"Проверка результатов независимых экспертов…":
      "Показать настоящее сравнение разметок HRCT"}</button>
  {error&&<p role="alert">{error}</p>}
  {report&&<div style={{margin:"12px 0"}}>
    <p role="status">Сопоставлены настоящие исходные маски трёх независимых
      разметчиков и их общий STAPLE-эталон на 40 исходных тестовых
      аксиальных срезах. Все исходные файлы проверены по SHA-256.</p>
    <table style={{width:"100%",borderCollapse:"collapse"}}>
      <caption>Средний Dice относительно консенсуса STAPLE, по отдельным 2D-срезам</caption>
      <thead><tr>
       <th scope="col">Паттерн</th><th scope="col">Эксперт 1</th>
       <th scope="col">Эксперт 2</th><th scope="col">Эксперт 3</th>
      </tr></thead>
      <tbody>{(["groundGlassOpacity","consolidation"] as const).map(name=><tr key={name}>
       <th scope="row">{name==="groundGlassOpacity"?"Матовое стекло":"Консолидация"}</th>
       {(["annotator1","annotator2","annotator3"] as const).map(k=>
         <td key={k}>{report.test40[name][k].mean2DDice.toFixed(3)}
           <small style={{display:"block"}}>{report.test40[name][k].nonEmptyUnionSlices}/40 срезов</small>
         </td>)}
      </tr>)}</tbody>
    </table>
    <p>Оригинальное исследование LongCIU содержит <strong>90 независимых 2D-срезов
      разных пациентов</strong>, упакованных в NIfTI. Это НЕ непрерывный
      трёхмерный том одного лёгкого, поэтому нельзя вычислять из этих масок
      объём фиброза или пространственную распространённость заболевания.</p>
    <p role="note">MEDPSeg: авторская модельная маска существует, но её
      пространственная привязка пока не прошла независимый аудит.
      Результат модели намеренно скрыт: не выдаём подозрительное
      сравнение за истинную точность нейросети.</p>
    <p role="alert"><strong>Не диагностика фиброзирующих ИЗЛ.</strong>
      Нет размеченного «сотового лёгкого», ретикуляции,
      тракционных бронхоэктазов или экспертного UIP-паттерна.
      Консенсус построен из масок этих же экспертов и не является
      независимой четвёртой врачебной оценкой.</p>
    <p><small><a href="https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38753711714"
      target="_blank" rel="noopener noreferrer">Подтверждённый исходный GitHub CPU-расчёт</a>
      {" "}· <a href="https://doi.org/10.25820/data.007301"
      target="_blank" rel="noopener noreferrer">LongCIU · University of Iowa</a>
      {" "}· ODC-By 1.0.</small></p>
    <button type="button" onClick={()=>setReport(null)}>Закрыть экспертную оценку</button>
  </div>}
 </section>;
}
