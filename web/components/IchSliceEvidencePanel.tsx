"use client";

import {useState} from "react";
import {parseIchSliceEvidence,type IchSliceEvidence} from "../lib/ich-slice-evidence";
import type {IchReferenceComparison} from "../lib/ich-reference-comparison";
import type {IchResearchReport} from "../lib/ich-research";

export default function IchSliceEvidencePanel({comparison,model,onGoToSlice}:{
  comparison:IchReferenceComparison;model:IchResearchReport;
  onGoToSlice?:(nativeSliceIndex:number)=>void;
}){
  const [audit,setAudit]=useState<IchSliceEvidence|null>(null);
  const [error,setError]=useState("");
  async function open(file:File){
    setAudit(null);setError("");
    try{
      if(!file.size||file.size>2*1024*1024)throw Error("Неверный размер JSON.");
      setAudit(parseIchSliceEvidence(await file.text(),comparison,model));
    }catch(e){setError(e instanceof Error?e.message:"Срезовые данные не приняты.");}
  }
  const a=audit?.sliceAudit;
  const canNavigate=a?.sourceBoundSliceAxis===2&&model.source.geometry.sliceAxis===2;
  const [missedSort,setMissedSort]=useState<"count"|"fraction">("count");
  const missed=a?.sliceEvidence.filter(x=>x.falseNegativeVoxels>0)
    .sort((x,y)=>missedSort==="count"
      ?y.falseNegativeVoxels-x.falseNegativeVoxels||x.nativeSliceIndex-y.nativeSliceIndex
      :y.falseNegativeVoxels/y.expertVoxels-x.falseNegativeVoxels/x.expertVoxels||
        y.falseNegativeVoxels-x.falseNegativeVoxels)
    .slice(0,12);
  const extra=a?.sliceEvidence.filter(x=>x.falsePositiveVoxels>0)
    .sort((x,y)=>y.falsePositiveVoxels-x.falsePositiveVoxels||
      x.nativeSliceIndex-y.nativeSliceIndex).slice(0,12);
  const incomplete=a?.sliceEvidence.filter(x=>x.falseNegativeVoxels>0).length??0;
  const fpSlices=a?.sliceEvidence.filter(x=>x.falsePositiveVoxels>0).length??0;
  return <section aria-label="Локализация пропущенной экспертной разметки по срезам"
    style={{border:"1px solid #a8bbb4",borderRadius:8,padding:12,margin:"14px 0"}}>
    <h5>Проверка локализации ошибок SAMIHS по исходным срезам</h5>
    <p>Загрузите JSON из <code>ich-native-slice-evidence.py</code>.
      Срезы привязаны к воксельной оси NIfTI, не к номерам DICOM.
      Отчёт проверяется относительно исходной КТ, предсказания и экспертной маски.</p>
    <label>Отчёт распределения ошибок по срезам
      <input type="file" accept=".json,application/json" onChange={e=>{
        const f=e.target.files?.[0];e.currentTarget.value="";
        if(f)void open(f);
      }}/>
    </label>
    {error&&<p role="alert">{error}</p>}
    {a&&<>
      <p role="status">Сопоставление трёх файлов по SHA-256 и проверка с 3D-метриками пройдены.</p>
      <p><strong>{a.expertPositiveSlices}</strong> срезов с экспертной кровоизлившейся областью;
        <strong> {a.expertPositiveSlicesWithVoxelOverlap}</strong> срезов с хотя бы одним совпавшим
        вокселем; <strong>{a.expertPositiveSlicesWithoutOverlap.length}</strong> экспертно
        положительных срезов без совпавших вокселей.
        Дополнительные кандидаты вне экспертно положительных срезов:
        <strong> {a.modelOnlyCandidateSlices.length}</strong>.</p>
      <p role="status"><strong>{incomplete}</strong> срезов содержат пропущенные
        экспертные воксели, включая частичные ошибки;
        <strong> {fpSlices}</strong> срезов содержат лишние воксели модели.
        Это очередь для просмотра врачом, не клинические FP/FN по исследованиям.</p>
      <label>Сортировка пропусков
        <select value={missedSort} onChange={e=>setMissedSort(e.target.value as "count"|"fraction")}>
          <option value="count">По числу пропущенных вокселей</option>
          <option value="fraction">По доле пропущенной экспертной области</option>
        </select>
      </label>
      {!canNavigate&&<p role="alert">Прямой переход отключён:
        индексный срез модели имеет ось {a.sourceBoundSliceAxis}, а просмотр
        исходного NIfTI показывает только ось k (2). Это разные плоскости.</p>}
      <p><small>Наличие одного совпавшего вокселя не означает правильно распознанное
        кровоизлияние. Это не чувствительность модели к очагам или пациентам.</small></p>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <caption style={{textAlign:"left",marginBottom:6}}>Приоритетные 12 срезов
            с полностью или частично пропущенной экспертной разметкой</caption>
          <thead><tr><th>Индекс среза</th><th>Эксперт, вокс.</th>
            <th>Пропущено, вокс.</th><th>Доля пропуска</th><th>Dice среза</th><th>Исходная КТ</th></tr></thead>
          <tbody>{missed?.map(x=><tr key={x.nativeSliceIndex}>
            <td>{x.nativeSliceIndex}</td><td>{x.expertVoxels}</td>
            <td>{x.falseNegativeVoxels}</td>
            <td>{(100*x.falseNegativeVoxels/x.expertVoxels).toFixed(1)}%</td>
            <td>{x.sliceDice===null?"—":x.sliceDice.toFixed(3)}</td>
            <td><button type="button" disabled={!canNavigate||!onGoToSlice}
              aria-label={`Открыть исходный срез k ${x.nativeSliceIndex+1}`}
              onClick={()=>onGoToSlice?.(x.nativeSliceIndex)}>КТ · срез</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div style={{overflowX:"auto",marginTop:12}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <caption style={{textAlign:"left",marginBottom:6}}>Наибольший объём лишней
            предсказанной маски — первые 12 срезов</caption>
          <thead><tr><th>Индекс среза</th><th>Предсказано, вокс.</th>
            <th>Лишние, вокс.</th><th>Dice среза</th><th>Исходная КТ</th></tr></thead>
          <tbody>{extra?.map(x=><tr key={x.nativeSliceIndex}>
            <td>{x.nativeSliceIndex}</td><td>{x.predictedVoxels}</td>
            <td>{x.falsePositiveVoxels}</td>
            <td>{x.sliceDice===null?"—":x.sliceDice.toFixed(3)}</td>
            <td><button type="button" disabled={!canNavigate||!onGoToSlice}
              aria-label={`Открыть исходный срез k ${x.nativeSliceIndex+1}`}
              onClick={()=>onGoToSlice?.(x.nativeSliceIndex)}>КТ · срез</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p><small>Исследовательская сегментация. Экспертная маска не удостоверена
        независимым аудитом; отсутствие предсказания не исключает кровоизлияние.</small></p>
      <button type="button" onClick={()=>setAudit(null)}>Закрыть срезовый отчёт</button>
    </>}
  </section>;
}
