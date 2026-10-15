"use client";

import {useState} from "react";
import {
  parseIchAlternativeReport,ICH_CLASSES,ICH_CLASS_LABELS,
  type IchAlternativeClass,type IchAlternativeReport,
} from "../lib/ianpan-ich-report";
import IchSourceNativeReview from "./IchSourceNativeReview";
import {groupIchResearchCandidateRegions} from "../lib/ianpan-ich-candidate-groups";

/**
 * Public-research JSON importer. Does not execute models or upload study data.
 * Original source image and anatomical registration are intentionally absent.
 */
export default function IanpanIchResearchResults(){
  const [report,setReport]=useState<IchAlternativeReport|null>(null);
  const [loadingRealExample,setLoadingRealExample]=useState(false);
  const [error,setError]=useState("");
  const [minScore,setMinScore]=useState(0.5);
  const [type,setType]=useState<IchAlternativeClass|"all">("all");
  const [notes,setNotes]=useState("");
  const spatialGroups=report?groupIchResearchCandidateRegions(report):null;
  const visible=(report?.candidates??[]).filter(c=>
    c.rawUncalibratedScore>=minScore&&(type==="all"||c.class===type)
  ).sort((a,b)=>a.sliceIndexModelOrdered-b.sliceIndexModelOrdered||
    b.rawUncalibratedScore-a.rawUncalibratedScore);
  return <section aria-label="Альтернативный детектор внутричерепного кровоизлияния"
    style={{padding:14,border:"1px solid #688f81",borderRadius:10,marginTop:18}}>
    <h3>КТ головы · альтернативный исследовательский ICH-детектор</h3>
    <p>Импорт классификационных оценок и областей локализации модели
      <strong> ianpan/ct-head-hemorrhage-detection</strong> после отдельного реального
      запуска на разрешённой публичной КТ с указанной степенью проверки HU.
      На этом экране вычисление модели не запускается, никакие DICOM не передаются.</p>
    <div style={{padding:"10px 0"}}>
      <button type="button" disabled={loadingRealExample}
        onClick={async()=>{
          setReport(null);setError("");setNotes("");setLoadingRealExample(true);
          try{
            const response=await fetch(
              "/examples/ianpan-ich-real-figshare-run-38734338486.json",
              {cache:"no-store"}
            );
            if(!response.ok)throw Error("Настоящий публичный результат сейчас недоступен.");
            const checked=parseIchAlternativeReport(await response.text());
            if(checked.source.niftiSha256!=="0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95"||
               checked.source.modelOrderedSliceCount!==25||
               checked.source.publishedFigshareHuLikeWithoutOriginalDicomRescaleAudit!==true||
               checked.source.sourceOriginalDicomHURescaleIndependentlyVerified!==false||
               checked.source.referenceLabelsOnlyPerihematomalEdema!==true||
               checked.candidates.length!==14||
               checked.seriesRawUncalibratedScores.intraparenchymal!==0.989428||
               checked.seriesRawUncalibratedScores.any!==0.993365||
               checked.externalExpertHemorrhageLocalizationComparisonPerformed!==false)
              throw Error("Публичный результат не соответствует проверенному запуску и источнику.");
            setReport(checked);
          }catch(e){setError(e instanceof Error?e.message:"Неверные исходные данные.");}
          finally{setLoadingRealExample(false);}
        }}>
        {loadingRealExample?"Проверка реальных находок…":"Показать настоящий результат ICH · 25 срезов"}
      </button>
      <p><small><a href="https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38734338486"
        target="_blank" rel="noopener noreferrer">Проверяемый реальный CPU-запуск №38734338486</a>
        {" "}· 14 записей «класс × срез» на 7 срезах, а НЕ 14 гематом.
        Это одна публичная КТ из отдельного датасета, не анализ текущего пациента.
        Эталонной маски гематомы нет.</small></p>
    </div>
    <label>JSON-отчёт выполнения предобученной модели (до 2 МиБ)
      <input type="file" accept=".json,application/json" onChange={async e=>{
        const f=e.target.files?.[0];e.currentTarget.value="";
        setReport(null);setError("");setNotes("");
        if(!f)return;
        try{
          if(f.size>2*1024*1024)throw Error("Слишком большой файл отчёта.");
          setReport(parseIchAlternativeReport(await f.text()));
        }catch(err){setError(err instanceof Error?err.message:"Неверный JSON-отчёт.");}
      }}/>
    </label>
    {error&&<p role="alert">{error}</p>}
    {!report?<p><small>Пока нет импортированного настоящего результата. Пустой экран
      не означает отсутствие кровоизлияния.</small></p>:<div>
      <p role="alert"><strong>Исследовательская модель, НЕ диагноз.</strong> JSON лишь
        декларирует запуск весов; подлинность выполнения, реальная HU-калибровка,
        корректность ориентации и соответствие экспертной маске здесь независимо
        не подтверждаются. Для новых результатов вычисляется положение
        области в координатах исходной NIfTI, но связь с DICOM SOP и
        подтверждение специалистом отсутствуют.
        Отсутствие кандидатов не позволяет исключить кровоизлияние.</p>
      <p>Источники: полный SHA-256 публичной NIfTI — <code>{report.source.niftiSha256}</code>.
        Модель: {report.model.id} ({report.model.revision}); заявленный режим —
        {report.runtime.executionDevice.toUpperCase()}, {report.runtime.elapsedSeconds.toFixed(1)} с.
        Модель обработала {report.source.modelOrderedSliceCount} упорядоченных срезов.
        Результат относится к <strong>другой публичной КТ</strong>, а не к текущей DICOM-серии.</p>
      {report.source.publishedFigshareHuLikeWithoutOriginalDicomRescaleAudit===true&&
        <p role="alert"><strong>Источник PHE-SICH-CT-IDS: HU только правдоподобны.</strong>
          Открытая оригинальная NIfTI содержит значения, совместимые со шкалой HU,
          но отдельные исходные DICOM RescaleSlope/Intercept не проверены.
          Опубликованная разметка относится к перифокальному отёку, НЕ к границам
          кровоизлияния. Здесь нет подтверждения точного очага, площади,
          гематомного объёма или клинической чувствительности. Результаты
          нейросети — неподтверждённые исследовательские предложения.
        </p>}
      <h4>Оценки шести категорий на уровне серии</h4>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8}}>
        {ICH_CLASSES.map(k=><div key={k} style={{padding:8,border:"1px solid #8b9b97",borderRadius:6}}>
          <strong>{ICH_CLASS_LABELS[k]}</strong>
          <div>{report.seriesRawUncalibratedScores[k].toFixed(3)}</div>
        </div>)}
      </div>
      <p><small>Числа — некалиброванные выходные оценки нейросети, НЕ клиническая вероятность
        заболевания и НЕ доказательство патологического очага.</small></p>
      {spatialGroups&&<section aria-label="Пространственные группы исследовательских ICH-кандидатов"
        style={{border:"1px solid #8b9b97",padding:10,borderRadius:8,margin:"12px 0"}}>
        <strong>Пространственные группы кандидатов — не подсчёт гематом</strong>
        <p role="status">{spatialGroups.groups.length} групп по совпадению локализации
          на соседних срезах. Повторяющиеся каналы «любое кровоизлияние»:
          {" "}{spatialGroups.anyCategoryDuplicatesSuppressed} не засчитаны повторно.
          Нелокализованных классификационных записей:
          {" "}{spatialGroups.unlocalizedClassifierEntries}.</p>
        <p><small>Группы вычислены только из модельных рамок на соседних срезах.
          Это НЕ контур гематомы, не измерение объёма, не установленное число
          патологических очагов и не подтверждение диагноза.</small></p>
        {spatialGroups.groups.map(g=><div key={g.id}
          style={{borderTop:"1px solid #8b9b97",padding:"8px 0"}}>
          <strong>{ICH_CLASS_LABELS[g.candidateClass]}</strong>
          <div>Срезы модели {g.firstModelSliceZeroBased+1}–{g.lastModelSliceZeroBased+1}
            {" "}· {g.modelSlicesWithRegions} срезов с пространственной областью
            {" "}· максимальная оценка {g.peakRawUncalibratedScore.toFixed(3)}</div>
          <div>Охватывающая область 512 × 512: {g.modelInputBoundingEnvelopeXY.join(" / ")}</div>
          {g.nativeNiftiBoundingEnvelopeXYZ&&<div>
            Границы нативных вокселей исходной NIfTI (XYZ):
            {" "}{g.nativeNiftiBoundingEnvelopeXYZ.join(" / ")}.
            Это ограничивающая рамка, не гематомный объём.</div>}
          <button type="button" onClick={()=>{
            setType(g.candidateClass);setMinScore(0.5);
          }}>Показать посрезовые записи этой категории</button>
        </div>)}
      </section>}
      <div style={{display:"flex",gap:12,flexWrap:"wrap",margin:"12px 0"}}>
        <label>Категория <select value={type}
          onChange={e=>setType(e.target.value as IchAlternativeClass|"all")}>
          <option value="all">Все категории</option>
          {ICH_CLASSES.map(k=><option key={k} value={k}>{ICH_CLASS_LABELS[k]}</option>)}
        </select></label>
        <label>Исследовательский порог {minScore.toFixed(2)} <input type="range"
          min="0.5" max="1" step="0.05" value={minScore}
          onChange={e=>setMinScore(Number(e.target.value))}/></label>
      </div>
      <p role="status">Предложено {report.candidates.length} записей «класс × срез» (не число гематом),
        по фильтру {visible.length}. Кандидаты не подтверждены врачом.</p>
      <div style={{maxHeight:300,overflowY:"auto"}}>
        {visible.map(c=><div key={c.sliceIndexModelOrdered+"/"+c.class}
          style={{margin:"8px 0",padding:8,borderBottom:"1px solid #8b9b97"}}>
          <strong>{ICH_CLASS_LABELS[c.class]}</strong> · модельный срез
          {" "}{c.sliceIndexModelOrdered+1}/{report.source.modelOrderedSliceCount}
          {" "}· score {c.rawUncalibratedScore.toFixed(3)}
          <div>Площадь карты при пороге 0,5: {c.heatmapPositivePixelsAtPoint5}
            {" "}пикселей из модельных 512 × 512 (не площадь очага в мм²).</div>
          <div>{c.modelInputBoundingBoxXY?
            `Рамка на предобработанном изображении: ${c.modelInputBoundingBoxXY.join(" / ")}`:
            "Карты выше порога 0,5 нет; классификация сама по себе не локализует очаг."}
          </div>
          {c.sourceVoxelProjection&&<div style={{marginTop:6,padding:7,border:"1px dashed #9b8298",borderRadius:6}}>
            <strong>Расчётная локализация на исходной NIfTI (не диагноз)</strong>
            <div>Нативные координаты вокселей XYZ, рамка: {" "}
              {c.sourceVoxelProjection.boundingBoxNativeNiftiXYZ.join(" / ")}</div>
            <div>Границы в RAS, мм: {" "}
              {c.sourceVoxelProjection.boundingBoxWorldRasMm.join(" / ")}</div>
            {c.sourceVoxelProjection.trimmedOutsideOriginalCT&&
              <div>Часть модельной рамки находится вне исходного поля КТ; область обрезана.</div>}
            <small>Геометрия рассчитана обратным преобразованием ориентации LPS
              и дополнения до 512 × 512. Независимая клиническая проверка
              совмещения и сопоставление с экспертной маской не выполнены.</small>
          </div>}
          {c.sourceVoxelProjection===null&&<small>Проекция на NIfTI отсутствует:
            карта пуста либо её область лежит в полях дополнения модели.</small>}
        </div>)}
      </div>
      <IchSourceNativeReview key={report.source.niftiSha256+report.runtime.elapsedSeconds} report={report}/>
      <label style={{display:"block",marginTop:12}}>Комментарий врача-исследователя (не удостоверен)
        <textarea rows={2} maxLength={1500} value={notes}
          onChange={e=>setNotes(e.target.value)}
          placeholder="Что необходимо проверить на исходной КТ, сопоставить с экспертной разметкой…"
          style={{display:"block",width:"100%"}}/>
      </label>
      <button type="button" onClick={()=>{
        // The export remains a research observation, not a signed patient record.
        const exportData={
          schema:"opus-ianpan-ich-local-unsigned-review/v1",
          scope:"separate_public_research_study_only",
          sourceNiftiSha256:report.source.niftiSha256,
          modelId:report.model.id,modelRevision:report.model.revision,
          candidateCount:report.candidates.length,
          researchSpatialCandidateGroups:spatialGroups?.groups.length??0,
          spatialGroupsAreProvenHematomas:false,
          reviewerNote:notes,
          modelToSourceCoordinatesVerified:false,
          sourceHUIndependentlyVerified:false,
          publishedSourceHuOnlyPlausible:report.source.publishedFigshareHuLikeWithoutOriginalDicomRescaleAudit===true,
          publishedReferenceOnlyPerihematomalEdema:report.source.referenceLabelsOnlyPerihematomalEdema===true,
          patientDicomLinked:false,
          automatedDiagnosis:false,
          clinicalValidation:false,
          absenceOfHemorrhageEstablished:false,
        };
        const url=URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],
          {type:"application/json"}));
        const a=document.createElement("a");a.href=url;
        a.download="opus-ich-alternative-unsigned-research-review.json";
        document.body.appendChild(a);a.click();a.remove();
        window.setTimeout(()=>URL.revokeObjectURL(url),1000);
      }}>Скачать неподписанную исследовательскую заметку</button>{" "}
      <button type="button" onClick={()=>{
        setReport(null);setNotes("");setError("");
      }}>Закрыть результат</button>
      <p><small>В новых отчётах координаты областей теперь вычисляются в
        нативных вокселях NIfTI обратным преобразованием из модели; источник
        связан SHA-256. Это не отображение исходных пикселей, не экспертная
        сегментация и не независимое подтверждение совпадения с DICOM.
        Для диагностики необходим врач и внешняя клиническая валидация.</small></p>
    </div>}
  </section>;
}
