"use client";

import {useState} from "react";
import {parseEffusionResearchReport,type EffusionResearchReport} from "../lib/chest-effusion-research";

/** Pure browser import of independently generated original model evidence.
 * This does not run AI, deidentify DICOM or prove clinical pathology.
 */
export default function ChestEffusionResearchResults({isChestCT}:{isChestCT:boolean}){
  const [report,setReport]=useState<EffusionResearchReport|null>(null);
  const [error,setError]=useState("");
  const [selectedClass,setSelectedClass]=useState<2|3>(2);
  const candidate=report?.fluidCandidates.find(c=>c.labelId===selectedClass);
  return <section className="cs-geometry" aria-label="Плевральный и перикардиальный выпот · исследовательский разбор">
    <h3>Плевральный и перикардиальный выпот · TotalSegmentator</h3>
    <p>Отдельный детектор патологии грудной клетки, task 315. Принимается только
      результат исходной предобученной модели с проверенной NIfTI-геометрией.
      Анатомическая метка №1 не является жидкостью и исключается из патологических показателей.</p>
    {!isChestCT&&<p role="note">Для исследований грудной клетки выберите КТ грудной клетки.
      Импорт независимого исследовательского NIfTI-отчёта не означает
      привязку находки к выбранному DICOM-исследованию.</p>}
    <label>Числовой отчёт оригинальной CT-маски task 315 (.json)
      <input type="file" accept=".json,application/json"
        onChange={async e=>{
          const f=e.currentTarget.files?.[0];e.currentTarget.value="";
          setError("");setReport(null);
          if(!f)return;
          try{
            if(f.size<64||f.size>512*1024)throw Error("Отчёт должен быть не больше 512 КиБ.");
            setReport(parseEffusionResearchReport(await f.text()));
            setSelectedClass(2);
          }catch(err){setError(err instanceof Error?err.message:"Ошибка импорта КТ-отчёта.");}
        }}/>
    </label>
    {error&&<p role="alert">{error}</p>}
    {!report?<p><small>Подтверждённого реального вывода task 315 для публичной КТ
      грудной клетки пока нет. Из существующей анатомической маски или
      результата другой модели нельзя построить фиктивный отчёт о выпоте.</small></p>:<>
      <p><strong>Исходная КТ:</strong> {report.originalCTDimensionsXYZ.join(" × ")}
        {" "}вокселей. Маска связана SHA-256 и проверкой пространственных
        координат (0,05 мм), но происхождение предобученных весов независимо
        от этого отчёта ещё не доказано.</p>
      <p>Объём одного исходного вокселя: {report.voxelVolumeMl.toFixed(5)} мл.
        Метка 1 — {report.anatomicalClassLungPleuralVoxelCountNotFluid} вокселей
        плевральной анатомической области; <strong>не включены</strong> в объёмы жидкости.</p>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"12px 0"}}>
        <button type="button" aria-pressed={selectedClass===2} onClick={()=>setSelectedClass(2)}>
          Плевральная жидкость · метка 2
        </button>
        <button type="button" aria-pressed={selectedClass===3} onClick={()=>setSelectedClass(3)}>
          Перикардиальная жидкость · метка 3
        </button>
      </div>
      {candidate&&<div style={{padding:12,border:"1px solid #8a9a9a",borderRadius:10}}>
        <strong>{candidate.pathologyClass==="pleural_effusion"?
          "Плевральный выпот · модельная гипотеза":
          "Перикардиальный выпот · модельная гипотеза"}</strong>
        <p>{candidate.modelPositiveNativeVoxelCount===0?
          "Модель не выделила воксели этого класса. Отсутствие выпота не установлено.":
          `Положительных вокселей исходной маски: ${candidate.modelPositiveNativeVoxelCount}.
          Исследовательский объём модельной маски: ${candidate.modelUnvalidatedFluidLabelVolumeMl.toFixed(2)} мл.`}</p>
        {candidate.nativeIndexBoundsXYZMin&&candidate.nativeIndexBoundsXYZMax&&<>
          <p>Диапазон исходных срезов NIfTI (нумерация от 1):
            {" "}{candidate.nativeSourceSliceIndicesK[0]+1}–
            {candidate.nativeSourceSliceIndicesK.at(-1)!+1}.
            Индексная рамка XYZ: {candidate.nativeIndexBoundsXYZMin.join(", ")}
            {" "}→ {candidate.nativeIndexBoundsXYZMax.join(", ")}.</p>
          <p>RAS мм: {candidate.worldRasBoundsMmMin?.map(n=>n.toFixed(2)).join(", ")}
            {" "}→ {candidate.worldRasBoundsMmMax?.map(n=>n.toFixed(2)).join(", ")}.</p>
        </>}
      </div>}
      <p role="alert"><strong>Не подтверждено клинически.</strong> Числовой паспорт
        не удостоверяет реальный запуск весов, точность сегментации, диагноз
        или наличие/отсутствие выпота. Не выполняется DICOM SOP-привязка;
        данные относятся к отдельному NIfTI и не переносятся на пациента.</p>
      <button type="button" onClick={()=>{setReport(null);setError("");}}>
        Удалить исследовательский отчёт из просмотра
      </button>
    </>}
  </section>;
}
