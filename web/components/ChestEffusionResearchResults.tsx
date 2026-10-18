"use client";

import {useState} from "react";
import {sha256} from "@noble/hashes/sha2.js";
import {parseRealPlethoraHumanReference,type PlethoraHumanReference} from "../lib/plethora-real-reference";
import type {EffusionResearchReport} from "../lib/chest-effusion-research";
import {parseImportedTask315,type ImportedTask315} from "../lib/chest-effusion-execution";

/** Pure browser import of independently generated original model evidence.
 * This does not run AI, deidentify DICOM or prove clinical pathology.
 */
export default function ChestEffusionResearchResults({isChestCT}:{isChestCT:boolean}){
  const [report,setReport]=useState<EffusionResearchReport|null>(null);
  const [execution,setExecution]=useState<ImportedTask315["execution"]|null>(null);
  const [error,setError]=useState("");
  const [humanReference,setHumanReference]=useState<PlethoraHumanReference|null>(null);
  const [humanBusy,setHumanBusy]=useState(false);
  const [humanError,setHumanError]=useState("");
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
    <div style={{border:"1px solid #91a7a2",padding:12,borderRadius:8,margin:"12px 0"}}>
      <strong>Независимый врачебный эталон плеврального выпота · TCIA PleThora</strong>
      <p>В публичном наборе 78 пар экспертных пересмотров. Можно открыть
        зафиксированное реальное сравнение двух врачебных масок на одном
        исследовании, не загружая изображения на сервер и не выполняя нейросеть.</p>
      <button type="button" disabled={humanBusy} onClick={async()=>{
        setHumanBusy(true);setHumanError("");setHumanReference(null);
        try{
          const response=await fetch(
            "/examples/plethora-real-two-human-effusion-reference-run-38750003799.json",
            {cache:"no-store"});
          if(!response.ok)throw Error("Эталонные числовые данные TCIA сейчас недоступны.");
          const bytes=new Uint8Array(await response.arrayBuffer());
          const digest=Array.from(sha256(bytes),n=>n.toString(16).padStart(2,"0")).join("");
          const content=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
          setHumanReference(parseRealPlethoraHumanReference(content,digest));
        }catch(e){setHumanError(e instanceof Error?e.message:"Ошибка загрузки эталона.");}
        finally{setHumanBusy(false);}
      }}>{humanBusy?"Проверка оригинального результата TCIA…":
          "Показать реальное согласие двух экспертных разметок"}</button>
      {humanError&&<p role="alert">{humanError}</p>}
      {humanReference&&<div>
        <p role="status"><strong>Human–human Dice:
          {" "}{humanReference.humanExpertInterreaderDice.toFixed(3)}</strong>
          {" "}— измеренное совпадение двух отдельных экспертных
          сегментаций плеврального выпота, НЕ точность TotalSegmentator.</p>
        <p>Исходная разметка 1: {" "}{humanReference.originalReviewerAMaskVolumeMl.toFixed(2)} мл
          {" "}({humanReference.originalReviewerAMaskVoxels.toLocaleString("ru-RU")} вокселей).
          Разметка 2: {" "}{humanReference.originalReviewerBMaskVolumeMl.toFixed(2)} мл
          {" "}({humanReference.originalReviewerBMaskVoxels.toLocaleString("ru-RU")} вокселей).
          Совпадающих вокселей {humanReference.originalExpertIntersectionVoxels.toLocaleString("ru-RU")}.</p>
        <p>Различия по {humanReference.humanExpertDiscordantSliceCount} исходным
          индексным срезам из {humanReference.originalShapeXYZ[2]}.
          Маски имеют подтверждённую общую физическую NIfTI-сетку,
          но оригинальная DICOM КТ для этих разметок ещё не загружена.</p>
        <p role="note">Числовое сопоставление с нейросетью невозможно до запуска
          именно на соответствующей CT: этот экспертный случай не равен
          автоматически текущему JSON выпота или выбранной серии DICOM.
          Границы исходного DICOM RAI и NIfTI RPI требуют регистрации.</p>
        <p><small><a href="https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38750003799"
          target="_blank" rel="noopener noreferrer">Подлинный CPU-расчёт исходных
          экспертных масок · GitHub Actions</a>.
          Источник TCIA DOI 10.7937/tcia.2020.6c7y-gq39, CC BY 3.0.</small></p>
      </div>}
    </div>
    <label>Числовой отчёт оригинальной CT-маски task 315 (.json)
      <input type="file" accept=".json,application/json"
        onChange={async e=>{
          const f=e.currentTarget.files?.[0];e.currentTarget.value="";
          setError("");setReport(null);setExecution(null);
          if(!f)return;
          try{
            if(f.size<64||f.size>512*1024)throw Error("Отчёт должен быть не больше 512 КиБ.");
            const checked=parseImportedTask315(await f.text());
            setReport(checked.evidence);setExecution(checked.execution);
            setSelectedClass(2);
          }catch(err){setError(err instanceof Error?err.message:"Ошибка импорта КТ-отчёта.");}
        }}/>
    </label>
    {error&&<p role="alert">{error}</p>}
    {!report?<p><small>Подтверждённого реального вывода task 315 для публичной КТ
      грудной клетки пока нет. Из существующей анатомической маски или
      результата другой модели нельзя построить фиктивный отчёт о выпоте.</small></p>:<>
      {execution==="reported-pretrained-execution"&&<p role="status"><strong>Есть отчёт о вызове предобученной task315.</strong> Исходный NIfTI, выходная маска и исследовательские числа сопоставлены по SHA. Сам файл checkpoint хеширован, но независимого подтверждения фактически загруженных весов и точности модели пока нет.</p>}
      {execution==="source-mask-only"&&<p role="note">Импортирована только маска/числовой паспорт. Он сам по себе не подтверждает, что нейросеть действительно запускалась.</p>}
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
      <button type="button" onClick={()=>{setReport(null);setExecution(null);setError("");}}>
        Удалить исследовательский отчёт из просмотра
      </button>
    </>}
  </section>;
}
