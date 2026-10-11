"use client";

import { useMemo, useState } from "react";
import type { DicomSeries } from "../lib/dicom-series";
import { analyzeDicomStudy } from "../lib/study-intelligence-v17";

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
          {item.issues.map((warning, j) => <p className={warning.level === "warning" ?
            "ora-study-intel-warning" : "ora-study-intel-info"} key={warning.code + j}>
              {warning.message}
            </p>)}
          <button type="button" onClick={() => onSelectSeries(item.key)}>Открыть эту серию</button>
        </div>)}
      </div>
      <p className="ora-study-intel-footnote">
        Распознавание протокола предварительное: только стандартные технические теги, без
        свободного текста SeriesDescription / ProtocolName, анализа пикселей и внешней отправки.
        Проверки патологий здесь нет.
      </p>
    </>}
  </section>;
}
