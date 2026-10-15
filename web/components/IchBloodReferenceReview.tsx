"use client";

import {useRef,useState} from "react";
import {sha256} from "@noble/hashes/sha2.js";
import {parseNiftiMask,MAX_MASK_FILE_BYTES} from "../lib/segmentation-mask";
import type {IchAlternativeReport} from "../lib/ianpan-ich-report";
import {parseIchBloodExpertSpatialReview,
  type IchBloodReferenceResult} from "../lib/ianpan-blood-reference";

const digestHex=(bytes:Uint8Array)=>Array.from(sha256(bytes),v=>
  v.toString(16).padStart(2,"0")).join("");

/** Never show imported numbers as trusted unless original blood-label bytes
 * exactly match the reference report. The browser does NOT independently
 * verify the author's radiologist qualifications or original CT affine.
 */
export default function IchBloodReferenceReview({model,originalModelReportSha256}:{
  model:IchAlternativeReport;originalModelReportSha256:string;
}){
  const [comparison,setComparison]=useState<IchBloodReferenceResult|null>(null);
  const [maskVerified,setMaskVerified]=useState(false);
  const [referenceError,setReferenceError]=useState("");
  const [busy,setBusy]=useState(false);
  const serial=useRef(0);
  const openReport=async(file:File)=>{
    ++serial.current;setComparison(null);setMaskVerified(false);setReferenceError("");
    try{
      if(!file.size||file.size>2*1024*1024)
        throw Error("Паспорт экспертного сравнения превышает 2 МиБ.");
      const parsed=parseIchBloodExpertSpatialReview(await file.text(),
        model,originalModelReportSha256);
      setComparison(parsed);
    }catch(e){setReferenceError(e instanceof Error?e.message:"Не удалось сверить экспертный паспорт.");}
  };
  const verifyMask=async(file:File)=>{
    const token=++serial.current;
    setMaskVerified(false);setReferenceError("");setBusy(true);
    try{
      if(!comparison||file.size<352||file.size>MAX_MASK_FILE_BYTES||
         !file.name.toLowerCase().endsWith(".nii"))
        throw Error("Нужна оригинальная маска крови NIfTI-1 .nii размером не более 32 МиБ.");
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(token!==serial.current)return;
      if(digestHex(bytes)!==comparison.evidenceHashes.originalExpertMaskSha256)
        throw Error("SHA-256 экспертной маски НЕ совпал с источником отчёта.");
      const original=parseNiftiMask(bytes.buffer as ArrayBuffer);
      const dims=comparison.originalNativeShapeXYZ;
      if(dims.some((v,i)=>v!==original.dimensions[i]))
        throw Error("Размеры оригинальной маски не совпадают с КТ.");
      const allowed=new Set(comparison.referenceClasses.map(c=>c.label));
      if(original.labels.some(l=>!allowed.has(l.id)))
        throw Error("В маске присутствуют метки без документированного значения крови.");
      for(const c of comparison.referenceClasses){
        const item=original.labels.find(l=>l.id===c.label);
        const voxels=item?.voxels??0;
        if(voxels!==c.referencePositiveVoxels||
           Math.abs(voxels*original.voxelVolumeMm3/1000-c.expertReferenceVolumeMl)>0.00001)
          throw Error("Воксели/физический объём крови не совпадают с паспортом сравнения.");
      }
      if(token===serial.current)setMaskVerified(true);
    }catch(e){
      if(token===serial.current)setReferenceError(e instanceof Error?e.message:"Экспертный файл не принят.");
    }finally{
      if(token===serial.current)setBusy(false);
    }
  };
  return <section aria-label="Экспертное сравнение ICH-кандидатов с оригинальной маской крови"
    style={{border:"1px solid #91a5a0",borderRadius:9,padding:12,marginTop:16}}>
    <h4>Независимая маска крови · проверка локализации</h4>
    <p>Модуль принимает результат отдельной разрешённой врачебной разметки
      геморрагического очага и пространственного сравнения с исходными
      областями предобученной модели. <strong>Маска перифокального отёка
      для такой проверки непригодна.</strong></p>
    <label>Паспорт внешнего сравнения с настоящей маской крови (.json)
      <input type="file" accept=".json,application/json" onChange={e=>{
        const f=e.currentTarget.files?.[0];e.currentTarget.value="";
        if(f)void openReport(f);
      }}/>
    </label>
    {referenceError&&<p role="alert">{referenceError}</p>}
    {comparison&&<>
      <p>Паспорт связан с текущей моделью и SHA-256 исходной КТ.
        Исходная референсная маска должна быть подтверждена отдельно.</p>
      <label>Оригинальная экспертная маска крови (несжатый .nii)
        <input type="file" accept=".nii,application/octet-stream" disabled={busy}
          onChange={e=>{
            const f=e.currentTarget.files?.[0];e.currentTarget.value="";
            if(f)void verifyMask(f);
          }}/>
      </label>
      {busy&&<p role="status">Проверка SHA-256 и меток оригинальной экспертной маски…</p>}
      {maskVerified?<div>
        <p role="status">Оригинальные байты маски, номера меток, количество вокселей
          и физические объёмы совпали с внешним паспортом. Подлинность
          независимого экспертного авторства и совпадение исходных DICOM
          в браузере не удостоверены.</p>
        {comparison.referenceClasses.map(c=><div key={c.referenceClass}
          style={{borderBottom:"1px solid #91a5a0",padding:"8px 0"}}>
          <strong>{c.referenceClass} · только экспертная кровь</strong>
          <div>Размечено: {c.referencePositiveVoxels} вокселей;
            экспертный объём {c.expertReferenceVolumeMl.toFixed(3)} мл.</div>
          <div>Число исходных модельных рамок: {c.subtypeCandidateBoxes}.</div>
          {c.expertVoxelShareInsideModelBoxes===null?
            <div>Показатель покрытия отсутствует: экспертная маска класса пуста.</div>:
            <div>Внутри модельных ограничивающих областей:
              {" "}{c.expertVoxelsInsideModelBoxUnion} экспертных вокселей
              {" "}({(c.expertVoxelShareInsideModelBoxes*100).toFixed(1)}%).
            </div>}
          <div>Экспертных 6-связных фрагментов, соприкасающихся с модельными
            прямоугольниками: {c.expertComponentsWithBoxIntersection}/
            {c.expertComponentsTotal}.</div>
        </div>)}
        <p role="alert"><strong>Не показатель точности сегментации.</strong>
          Охват рамками не равен Dice, воксельной чувствительности,
          количеству истинно обнаруженных гематом или прогнозу.
          Самостоятельное доказательство достоверности экспертных
          меток и оригинального DICOM отсутствует.</p>
      </div>:<p><small>Результаты покрытия скрыты, пока оригинальная
        маска крови не совпадёт по SHA-256 и данным с отчётом.</small></p>}
      <button type="button" onClick={()=>{
        ++serial.current;setComparison(null);setMaskVerified(false);
        setReferenceError("");setBusy(false);
      }}>Закрыть экспертное сопоставление</button>
    </>}
    {!comparison&&<p><small>Достоверного внешнего эталона гематомы
      для опубликованной исследовательской КТ сейчас нет.
      Из чисел самой нейросети нельзя получить экспертную разметку.</small></p>}
  </section>;
}
