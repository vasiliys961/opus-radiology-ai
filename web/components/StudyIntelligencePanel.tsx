"use client";

import { useMemo, useState } from "react";
import type { DicomSeries } from "../lib/dicom-series";
import { analyzeDicomStudy } from "../lib/study-intelligence-v17";
import {planAnatomicalTasks, type RouteReason} from "../lib/anatomy-task-router";

const REASON_LABELS:Readonly<Record<RouteReason,string>>={
  geometry_unverified:"Не подтверждена геометрия 3D-объёма",
  region_conflict:"Противоречивые анатомические коды внутри серии",
  protocol_role_unverified:"Не подтверждён статус исходных PRIMARY-срезов",
  multiple_studies:"Не подтверждена принадлежность к одному исследованию",
  source_incomplete_or_unknown:"Не все выбранные DICOM проиндексированы",
  ct_calibration_and_phase_unverified:"Требуется проверить HU и фазу КТ на исходных данных",
  mr_exact_sequences_unverified:"Требуются подтверждённые T1, T1c, T2, FLAIR",
  mr_4_series_not_confirmed:"Не обнаружены четыре самостоятельные серии единого протокола",
  clinical_coverage_unknown:"Полнота анатомического покрытия неизвестна",
  weights_not_connected:"Подходящая задача и веса не подключены для запуска из этого раздела",
  server_patient_use_blocked:"Работа с пациентом/облаком не разрешена",
};

export default function StudyIntelligencePanel({
  series, unindexed, onSelectSeries,
}: {
  series: readonly DicomSeries[];
  unindexed: number;
  onSelectSeries: (seriesKey: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const report = useMemo(() => analyzeDicomStudy(series, unindexed), [series, unindexed]);
  const taskRoutes = useMemo(() => planAnatomicalTasks(series, unindexed), [series, unindexed]);
  const risky = report.series.filter(s => s.issues.some(x => x.level === "warning")).length;
  const shown = onlyProblems ? report.series.filter(s => s.issues.some(x => x.level === "warning")) : report.series;
  return <section className="ora-study-intel" aria-label="Study Intelligence — технический разбор DICOM-исследования">
    <div className="ora-study-intel-head">
      <div><strong>Study Intelligence <span>v1.7</span></strong>
        <p>Технический анализ всех загруженных DICOM-серий · локально</p>
      </div>
      <button type="button" className="ora-study-intel-toggle"
        onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
        {expanded ? "Свернуть анализ" : "Все серии и протоколы"}
      </button>
    </div>
    <div className="ora-study-intel-stats">
      <div><strong>{report.indexedSeries}</strong><small>Серий</small></div>
      <div><strong>{report.indexedDicomFiles}</strong><small>Проиндексировано</small></div>
      <div><strong>{risky}</strong><small>Серий с предупреждениями</small></div>
      <div><strong>{report.unindexedDicomFiles}</strong><small>Без индекса</small></div>
    </div>
    <p className="ora-study-intel-boundary">Полнота анатомического охвата и протокола <strong>не подтверждена</strong>.
      Проверена только доступная техническая информация DICOM.</p>
    {expanded && <>
      <div className="ora-study-intel-filter">
        <label><input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)}/>
          Только серии с предупреждениями
        </label>
        <span>{report.studyCount} StudyInstanceUID</span>
      </div>
      {report.issues.filter(x => x.seriesKey === null).map((problem, index) => (
        <p key={problem.code + index} className={problem.level === "warning" ?
          "ora-study-intel-warning" : "ora-study-intel-info"}>{problem.message}</p>
      ))}
      <div className="ora-study-intel-series">
        {!shown.length && <p className="ora-study-intel-info">Серий для выбранного режима нет.</p>}
        {shown.map((item, index) => <div className="ora-study-intel-series-item" key={item.key}>
          <div className="ora-study-intel-row">
            <strong>Серия {index + 1} · {item.modality || "DICOM"}</strong>
            <span className={item.volumeReady ? "ora-study-intel-ready" : "ora-study-intel-review"}>
              {item.volumeReady ? "Геометрия MPR подтверждена" : "Проверить геометрию"}
            </span>
          </div>
          <div className="ora-study-intel-description">
            <span>Кадров: {item.frames}</span>
            <span>Область: {item.region}</span>
            <span>Тип: {item.imageRole}</span>
            {item.spatialExtentMm !== null && <span>Расстояние крайних срезов: {item.spatialExtentMm} мм</span>}
          </div>
          <p>Протокол: {item.protocolCandidate}</p>
          <p>Контраст: {item.contrast === "declared" ?
            "агент указан в DICOM; фаза не установлена" : "не подтверждён"}</p>
          <p>Признаки DICOM: надписи {item.privacyFlags.burnedInAnnotation},
            узнаваемые изображения {item.privacyFlags.recognizableVisualFeatures},
            PatientIdentityRemoved {item.privacyFlags.patientIdentityRemoved}.</p>
          <p>Даже теги NO и YES не подтверждают фактическое обезличивание.</p>
          {item.issues.map((warning, j) => <p className={warning.level === "warning" ?
            "ora-study-intel-warning" : "ora-study-intel-info"} key={warning.code + j}>
              {warning.message}
            </p>)}
          <button type="button" onClick={() => onSelectSeries(item.key)}>Открыть эту серию</button>
        </div>)}
      </div>
      <section className="ora-study-intel-series" aria-label="Маршруты анатомических AI-задач">
        <h3>Анатомические AI-задачи · выбор по протоколу</h3>
        <p className="ora-study-intel-boundary">Только подготовка задания по техническим DICOM-метаданным.
          На текущем этапе запуск моделей здесь <strong>не подключён</strong>.
          Анатомические маски не являются проверкой на патологию.</p>
        {!taskRoutes.length && <p className="ora-study-intel-info">Для этих серий подходящий анатомический маршрут не определён.
          Это не означает, что на снимках нет изменений.</p>}
        {taskRoutes.map((route,index)=><div key={route.id+"-"+index} className="ora-study-intel-series-item">
          <div className="ora-study-intel-row">
            <strong>{route.title}</strong>
            <span className="ora-study-intel-review">МОДЕЛЬ НЕ ПОДКЛЮЧЕНА</span>
          </div>
          <div className="ora-study-intel-description">
            <span>{route.modality} · {route.bodyRegion}</span>
            <span>Серий-кандидатов: {route.inputSeriesKeys.length}</span>
          </div>
          <p>Кандидат: {route.modelCandidate}</p>
          {route.technicalHints.map((hint,i)=><p key={i} className="ora-study-intel-info">{hint}</p>)}
          {route.reasons.map(reason=><p key={reason} className="ora-study-intel-warning">
            {REASON_LABELS[reason]}
          </p>)}
          <button type="button" onClick={()=>onSelectSeries(route.inputSeriesKeys[0])}>
            Открыть серию для проверки
          </button>
        </div>)}
      </section>
      <p className="ora-study-intel-footnote">
        Распознавание протокола предварительное: только стандартные технические теги, без
        свободного текста SeriesDescription / ProtocolName, анализа пикселей и внешней отправки.
        Проверки патологий здесь нет.
      </p>
    </>}
  </section>;
}
