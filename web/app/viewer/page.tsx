"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { groupDicomSeries, readDicomSeriesHeader, type DicomSeries } from "../../lib/dicom-series";
import { validateViewerFileSelection } from "../../lib/viewer-limits";
import "./viewer.css";

const CornerstoneStack = dynamic(() => import("../../components/CornerstoneStack"), {
  ssr: false,
  loading: () => <div className="cs-placeholder">Загрузка Cornerstone3D…</div>,
});

type Indexed = { id: string; file: File; header: Awaited<ReturnType<typeof readDicomSeriesHeader>> };

export default function ViewerPage() {
  const folderPicker = useRef<HTMLInputElement>(null);
  const [indexed, setIndexed] = useState<Indexed[]>([]);
  const [currentSeriesKey, setCurrentSeriesKey] = useState("");
  const [message, setMessage] = useState("Выберите папку с DICOM-файлами или набор отдельных файлов.");
  const [reading, setReading] = useState(false);

  const series = useMemo(() => groupDicomSeries(indexed.map((item) => ({ id: item.id, name: item.file.name, metadata: item.header }))), [indexed]);
  const selected: DicomSeries | undefined = series.find((item) => item.key === currentSeriesKey) ?? series[0];
  const indexedById = useMemo(() => new Map(indexed.map((item) => [item.id, item.file])), [indexed]);
  const selectedFiles = useMemo(() => selected?.members.map((item) => indexedById.get(item.id)).filter((file): file is File => !!file) ?? [], [selected, indexedById]);

  async function loadFiles(input: FileList | null) {
    if (!input || reading) return;
    const files = Array.from(input);
    const problem = validateViewerFileSelection(files);
    if (problem) { setMessage(problem); return; }
    setReading(true);
    setMessage("Чтение технических DICOM-заголовков, без загрузки на сервер…");
    const parsed: Indexed[] = [];
    let rejected = 0;
    const reasons = new Map<string, number>();
    try {
      for (const file of files) {
        try {
          const header = await readDicomSeriesHeader(file);
          parsed.push({ id: crypto.randomUUID(), file, header });
        } catch (error: unknown) {
          rejected++;
          const reason = error instanceof Error ? error.message : "Неизвестная ошибка индексации.";
          reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        }
      }
      // Replace, rather than merge, series so stale patient data cannot persist.
      setIndexed(parsed);
      setCurrentSeriesKey("");
      const mostCommon = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
      setMessage(`Проиндексировано ${parsed.length} DICOM; пропущено ${rejected}.${mostCommon ? ` Основная причина (${mostCommon[1]}): ${mostCommon[0]}.` : ""} Изображения остаются на вашем Mac.`);
    } finally { setReading(false); }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void loadFiles(event.target.files);
    event.target.value = "";
  }

  return <main className="cs-page">
    <header className="cs-top"><a href="/" aria-label="Вернуться в рабочую станцию">← OPUS RADIOLOGY</a><span>Cornerstone3D · экспериментальный просмотр</span><span>LOCAL / M1</span></header>
    <div className="cs-container">
      <div className="cs-intro"><div><div className="cs-kicker">IMAGING LAB / 2D STACK</div><h1>DICOM Viewer <em>β</em></h1><p>Просмотр локальных DICOM-серий с декодированием Cornerstone3D. Без облака, без анализа ИИ.</p></div><span className="cs-watermark">ИССЛЕДОВАТЕЛЬСКИЙ ПРОТОТИП · НЕ ДЛЯ ДИАГНОСТИКИ</span></div>
      <div className="cs-layout">
        <aside className="cs-sidebar">
          <h2>Загрузка серии</h2>
          <p>Откройте учебные или корректно обезличенные исследования.</p>
          <label className="cs-picker">Выбрать DICOM-файлы <input type="file" multiple accept=".dcm,.dicom,application/dicom" onChange={onPick} disabled={reading}/></label>
          <button type="button" className="cs-outline" disabled={reading} onClick={() => {
            if (folderPicker.current) {
              (folderPicker.current as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
              folderPicker.current.click();
            }
          }}>Выбрать папку DICOM</button>
          <input ref={folderPicker} type="file" className="cs-hidden" multiple onChange={onPick}/>
          <div className="cs-message" role="status">{reading ? "Идёт индексация…" : message}</div>
          {series.length > 0 && <>
            <h3>Серии ({series.length})</h3>
            <div className="cs-series-list">{series.map((s) => <button type="button" className={selected?.key === s.key ? "cs-series active" : "cs-series"} key={s.key} onClick={() => setCurrentSeriesKey(s.key)}>{s.label}</button>)}</div>
          </>}
          {selected && <div className="cs-geometry"><h3>Контроль геометрии</h3><p>{selected.spatiallySorted ? "✓ Пространственный порядок подтверждён" : "⚠ Порядок условный"}</p><p>{selected.volumeReady ? `✓ Предварительная геометрия для будущего 3D · ${selected.sliceSpacingMm?.toFixed(2)} мм` : "3D/MPR НЕ РАЗРЕШЕНЫ"}</p>{selected.warning && <p>{selected.warning}</p>}</div>}
          <button type="button" className="cs-clear" disabled={reading || indexed.length === 0} onClick={() => { setIndexed([]); setCurrentSeriesKey(""); setMessage("Список очищен, файлы на диске не изменены."); }}>Очистить загруженное</button>
        </aside>
        <div className="cs-stage">
          {selectedFiles.length ? <CornerstoneStack key={selected?.key} files={selectedFiles}/> : <div className="cs-placeholder"><span>✚</span><strong>Область DICOM-изображений</strong><p>Выберите файлы или папку DICOM, чтобы проверить работу Cornerstone3D.</p></div>}
          <div className="cs-bottom-note">Важное ограничение: 2D-просмотр не означает подтверждение точности измерений, реконструкции, правильной геометрии или отсутствия патологии. Сжатые кодеки проверяются отдельно на тестовых наборах.</div>
        </div>
      </div>
    </div>
  </main>;
}
