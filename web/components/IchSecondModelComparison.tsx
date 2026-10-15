"use client";
import {useState} from "react";
import {sha256} from "@noble/hashes/sha2.js";
import type {IchAlternativeReport} from "../lib/ianpan-ich-report";
import {parseGenuineIchTwoModelEvidence,
  type GenuineIchDualModelEvidence} from "../lib/ich-genuine-second-model-evidence";

const hex=(arr:Uint8Array)=>Array.from(sha256(arr),n=>n.toString(16).padStart(2,"0")).join("");
export default function IchSecondModelComparison({first,originalFirstSha}:{
  first:IchAlternativeReport;originalFirstSha:string;
}){
 const [report,setReport]=useState<GenuineIchDualModelEvidence|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const exactFirst=originalFirstSha==="c121d869f4358de9197232fc1c6eeb5ec2f6f8977af3e28ffb8130dcba365f62"&&
  first.source.niftiSha256==="0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95";
 return <section aria-label="Реальное независимое нейросетевое сравнение внутримозгового кровоизлияния"
  style={{border:"1px solid #9d898a",borderRadius:9,padding:12,margin:"14px 0"}}>
  <h4>Второе мнение нейросети · TotalSegmentator cerebral_bleed</h4>
  <p>Настоящий независимый инференс двух различных предобученных моделей
    на <strong>одной и той же исходной публичной КТ</strong>.
    TotalSegmentator выдаёт бинарную исследовательскую маску;
    ianpan — ограничивающие области, а не маску крови.</p>
  {exactFirst?<button type="button" disabled={loading} onClick={async()=>{
    setLoading(true);setError("");setReport(null);
    try{
      const res=await fetch("/examples/ich-genuine-independent-totalseg-ianpan-run-38747034560.json",
         {cache:"no-store"});
      if(!res.ok)throw Error("Оригинальный числовой результат второго детектора недоступен.");
      const bytes=new Uint8Array(await res.arrayBuffer());
      const digest=hex(bytes);
      const raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
      setReport(parseGenuineIchTwoModelEvidence(raw,first,originalFirstSha,digest));
    }catch(e){setError(e instanceof Error?e.message:"Ошибка чтения результата реальной модели.");}
    finally{setLoading(false);}
  }}>{loading?"Проверка двух моделей и оригинальных SHA…":
    "Сравнить с реальной второй предобученной моделью"}</button>:
    <p role="note">Сравнение недоступно: текущий загруженный отчёт не является
      точным оригинальным результатом модели ianpan для проверенного
      публичного исследования. Результаты другой КТ автоматически не сопоставляются.</p>}
  {error&&<p role="alert">{error}</p>}
  {report&&<div>
    <p role="status"><strong>Обе предобученные модели действительно выполнены.</strong>
      {" "}Источник 512 × 512 × 25; оригинальная КТ и отчёт первой модели
      совпадают по SHA-256, второй архив весов и числовой результат
      зафиксированы в отдельном успешном GitHub Actions.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
      <div><strong>{report.secondModelMaskPositiveVoxels.toLocaleString("ru-RU")}</strong>
        <div>Вокселей исследовательской маски второй модели</div></div>
      <div><strong>{report.secondModelUnvalidatedMaskVolumeMl.toFixed(2)} мл</strong>
        <div>Объём маски модели, НЕ объём подтверждённой гематомы</div></div>
      <div><strong>{(100*report.secondModelMaskShareWithinFirstModelBounds).toFixed(2)}%</strong>
        <div>Вокселей второй модели внутри прямоугольных областей ianpan</div></div>
    </div>
    <p>Точное численное сравнение: {" "}
      {report.secondModelMaskVoxelsInsideFirstModelBoundingBoxUnion.toLocaleString("ru-RU")} из
      {" "}{report.secondModelMaskPositiveVoxels.toLocaleString("ru-RU")} модельных
      вокселей попадают внутрь объединения рамок первой сети.
      За их пределами {report.secondModelMaskPositiveVoxels-
      report.secondModelMaskVoxelsInsideFirstModelBoundingBoxUnion} вокселей.</p>
    <p>Исходные срезы второй маски (нумерация с 1):
      {" "}{report.secondModelSourceSliceIndices.map(k=>k+1).join(", ")}.
      Первая модель предлагала области на срезах 10–16.
      <strong> Срез 17 отмечен только второй моделью</strong>;
      эта небольшая пространственная разница требует визуального пересмотра,
      а не автоматического признания ложноположительного очага.</p>
    <p><small>Веса TotalSegmentator: архив SHA-256
      {" "}{report.officialWeightsArchiveSha256.slice(0,16)}…;
      исходная маска второй модели SHA-256
      {" "}{report.secondModelOriginalMaskSha256.slice(0,16)}….
      Никакие пиксели исследования не включены в этот числовой JSON.</small></p>
    <p><small><a href="https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38747034560"
      target="_blank" rel="noopener noreferrer">Оригинальное выполненное исследование · GitHub Actions #38747034560</a>
      {" "}· архив доказательств #11980401798.</small></p>
    <p role="alert"><strong>Важное ограничение:</strong> 99,88% — пространственное
      согласие второй модельной маски с <em>прямоугольниками</em> первой,
      а НЕ Dice между двумя сегментациями и НЕ чувствительность обнаружения крови.
      Эталонная маска эксперта отсутствует. Опубликованные маски относятся к отёку,
      исходная DICOM HU-калибровка не проверялась независимо.
      Это не медицинское заключение и не подтверждённая гематома.</p>
  </div>}
 </section>;
}
