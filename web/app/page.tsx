"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import "./radiology.css";
import "./viewer/viewer.css";
import { decodeDicomPreview, type DicomPreviewMetadata } from "../lib/dicom-lite";
import { readDicomSeriesHeader, groupDicomSeries, type TechnicalDicomMetadata } from "../lib/dicom-series";
import { validateViewerFileSelection, MAX_DICOM_FILES } from "../lib/viewer-limits";
import { checkMprEligibility } from "../lib/mpr-eligibility";
import { assessMprQuality } from "../lib/mpr-quality";
import { uniqueNewFiles } from "../lib/study-files";
import AiWorkflowPanel from "../components/AiWorkflowPanel";

// Keep the sizable Cornerstone engine outside the initial dashboard bundle.
const CornerstoneMPR = dynamic(() => import("../components/CornerstoneMPR"), {
  ssr: false,
  loading: () => <div className="ora-viewer-placeholder ora-viewer-wait">Подготовка режима MPR…</div>,
});

const CornerstoneStack = dynamic(() => import("../components/CornerstoneStack"), {
  ssr: false,
  loading: () => <div className="ora-viewer-placeholder ora-viewer-wait">Запускаем DICOM-движок Cornerstone3D…</div>,
});

type Kind = "image" | "dicom" | "nifti" | "archive";
type StudyFile = { id: string; file: File; kind: Kind; previewUrl?: string; dicomMeta?: TechnicalDicomMetadata; indexWarning?: string };
type IconName = "pulse" | "scan" | "folder" | "grid" | "upload" | "search" | "settings" | "layers" | "sparkles" | "file" | "plus" | "minus" | "fit" | "trash" | "shield" | "arrow" | "info" | "check" | "brain" | "clipboard" | "cloud" | "chevron";

function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  const icons: Record<IconName, ReactNode> = {
    pulse: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
    scan: <><path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M3 17v2a2 2 0 0 0 2 2h2M21 17v2a2 2 0 0 1-2 2h-2" /><circle cx="12" cy="12" r="5" /><path d="M12 8v8M8 12h8" /></>,
    folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    upload: <><path d="M12 16V3m0 0-5 5m5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m9.7 3.7.6-1h3.4l.6 1 1 1.7 2-.1 1.6 2.9-1 1.7 1 1.7-1 1.7 1 1.7-1.6 2.9-2-.1-1 1.7-.6 1h-3.4l-.6-1-1-1.7-2 .1-1.6-2.9 1-1.7-1-1.7 1-1.7-1-1.7 1.6-2.9 2 .1 1-1.7Z" transform="translate(0 1) scale(1 .94)" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    sparkles: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 17l.7 1.3L21 19l-1.3.7L19 21l-.7-1.3L17 19l1.3-.7L19 17Z" /></>,
    file: <><path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    fit: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    shield: <><path d="M12 2 4 5v6c0 5 3.1 8.5 8 11 4.9-2.5 8-6 8-11V5l-8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    brain: <><path d="M12 19V6m0 13c-2 3-6 2-7-1-3 0-3-4-1-5-3-2-1-6 2-6 0-3 4-5 6-2 2-3 6-1 6 2 3 0 5 4 2 6 2 1 2 5-1 5-1 3-5 4-7 1Z" /><path d="M8 9c-2 1-2 3-1 4m9-4c2 1 2 3 1 4" /></>,
    clipboard: <><rect x="5" y="4" width="14" height="18" rx="2" /><path d="M9 4V2h6v2M8 11h8M8 15h8" /></>,
    cloud: <><path d="M7 18a5 5 0 0 1-.3-10 6 6 0 0 1 11.5 2.5A4 4 0 0 1 18 18H7Z" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

const formatSize = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(size / 1024))} КБ`;
const detectKind = (file: File): Kind | null => {
  const name = file.name.toLowerCase();
  if (/\.(png|jpg|jpeg|webp)$/.test(name) && file.type.startsWith("image/")) return "image";
  if (/\.(dcm|dicom)$/.test(name) || file.type === "application/dicom") return "dicom";
  if (/\.nii(\.gz)?$/.test(name)) return "nifti";
  if (/\.zip$/.test(name)) return "archive";
  return null;
};
const kindLabel: Record<Kind, string> = { image: "Изображение", dicom: "DICOM", nifti: "NIfTI", archive: "ZIP" };

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<StudyFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const allocatedUrls = useRef<string[]>([]);
  const [dragged, setDragged] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<"2d" | "mpr" | "3d">("2d");
  const [dicomPreview, setDicomPreview] = useState<{ id: string; url: string; metadata: DicomPreviewMetadata } | null>(null);
  const [dicomLoading, setDicomLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [dicomError, setDicomError] = useState("");
  const [notice, setNotice] = useState("");
  const [context, setContext] = useState("");
  const [studyName, setStudyName] = useState("");
  const [modality, setModality] = useState("Не определена");
  const active = files.find((item) => item.id === activeId) ?? null;
  const series = useMemo(() => groupDicomSeries(files.filter((f) => f.kind === "dicom" && f.dicomMeta).map((f) => ({
    id: f.id, name: f.file.name, metadata: f.dicomMeta!,
  }))), [files]);
  const activeSeries = series.find((group) => group.members.some((m) => m.id === activeId)) ?? null;
  // Memoized: switching non-DICOM controls must not restart a DICOM rendering engine.
  const cornerstoneFiles = useMemo(() => {
    if (!activeSeries) return [];
    const byId = new Map(files.map((item) => [item.id, item.file]));
    return activeSeries.members.map((item) => byId.get(item.id)).filter((file): file is File => !!file);
  }, [activeSeries, files]);
  const mprCheck = useMemo(() => checkMprEligibility(activeSeries, cornerstoneFiles.map(f => f.size)), [activeSeries, cornerstoneFiles]);
  const mprQuality = useMemo(() => assessMprQuality(activeSeries), [activeSeries]);
  // Every series is checked independently. A 40-slice sequence from the same
  // study can have a different acquisition geometry from a valid 20-slice one.
  const compatibleSeries = useMemo(() => {
    const sizes = new Map(files.map(item => [item.id, item.file.size]));
    return series.filter(group =>
      checkMprEligibility(group, group.members.map(item => sizes.get(item.id) ?? 0)).eligible);
  }, [series, files]);
  const compatibleAlternative = compatibleSeries.find(group => group.key !== activeSeries?.key) ?? null;
  const hasCornerstone = active?.kind === "dicom" && cornerstoneFiles.length > 0;
  const showMpr = hasCornerstone && viewMode !== "2d" && mprCheck.eligible;
  // Reset MPR on series changes and preserve normal 2D stack as the fallback.
  useEffect(() => { setViewMode("2d"); }, [activeSeries?.key]);
  const sliceIndex = activeSeries?.members.findIndex((m) => m.id === activeId) ?? -1;
  const selectSlice = (index: number) => {
    if (!activeSeries) return;
    const next = activeSeries.members[Math.max(0, Math.min(activeSeries.members.length - 1, index))];
    if (next) { setActiveId(next.id); setZoom(1); }
  };

  const url = active?.kind === "dicom"
    ? (!hasCornerstone && dicomPreview?.id === active.id ? dicomPreview.url : null)
    : (active?.previewUrl ?? null);

  useEffect(() => {
    if (active?.kind !== "dicom" || hasCornerstone) return;
    let cancelled = false;
    setDicomLoading(true);
    setDicomError("");
    setDicomPreview(null);
    decodeDicomPreview(active.file).then((preview) => {
      if (!cancelled) setDicomPreview({ id: active.id, ...preview });
    }).catch((err: unknown) => {
      if (!cancelled) setDicomError(err instanceof Error ? err.message : "Не удалось декодировать DICOM.");
    }).finally(() => { if (!cancelled) setDicomLoading(false); });
    return () => { cancelled = true; };
  }, [active?.id, active?.kind, active?.file, hasCornerstone]);
  useEffect(() => {
    document.title = "Opus Radiology AI — КТ и МРТ";
    const currentUrls = allocatedUrls.current;
    return () => currentUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
  }, []);

  const addFiles = async (incoming: File[]) => {
    if (!incoming.length || indexing) return;
    setIndexing(true);
    const accepted: StudyFile[] = [];
    let rejected = 0;
    let warningCount = 0;
    const warningReasons = new Map<string, number>();
    try {
      // Browser folder selection often repeats already loaded instances.
      // Deduplicate before indexing or applying per-Mac memory limits.
      const { newFiles, duplicates } = uniqueNewFiles(files.map(item => item.file), incoming);
      if (newFiles.length === 0) {
        setNotice(`Все ${incoming.length} выбранных файлов уже находятся в исследовании. Выберите нужную DICOM-серию в списке ниже.`);
        return;
      }
      // Never silently truncate a study folder: incomplete series can look
      // geometrically regular although frames are missing.
      if (newFiles.length > MAX_DICOM_FILES) {
        setNotice(`Выбрано ${newFiles.length} новых файлов (повторы: ${duplicates}), лимит одной загрузки — ${MAX_DICOM_FILES}. Выберите отдельную DICOM-серию вместо полной папки исследования.`);
        return;
      }
      const alreadyDicom = files.filter(item => item.kind === "dicom").length;
      const newDicom = newFiles.filter(file => detectKind(file) === "dicom").length;
      if (alreadyDicom + newDicom > MAX_DICOM_FILES) {
        setNotice(`Файлы не добавлены: уже загружено ${alreadyDicom} DICOM, выбрано ещё ${newDicom} новых; суммарно ${alreadyDicom + newDicom}, лимит ${MAX_DICOM_FILES}. Нынешнее исследование остаётся открытым. Для другого исследования нажмите «Очистить список» или выбирайте его серии по отдельности.`);
        return;
      }
      const limited = newFiles;
      // Limit memory use on 8 GB M1: inspect only header fragments, sequentially.
      for (const file of limited) {
        let kind = detectKind(file);
        if (!kind) {
          try {
            const signature = new Uint8Array(await file.slice(128, 132).arrayBuffer());
            if (signature.length === 4 && String.fromCharCode(...signature) === "DICM") kind = "dicom";
          } catch { /* Unsupported file: skip. */ }
        }
        if (!kind) { rejected++; continue; }
        const item: StudyFile = { id: crypto.randomUUID(), file, kind };
        if (kind === "image") {
          item.previewUrl = URL.createObjectURL(file);
          allocatedUrls.current.push(item.previewUrl);
        }
        if (kind === "dicom") {
          try { item.dicomMeta = await readDicomSeriesHeader(file); }
          catch (error: unknown) {
            warningCount++;
            item.indexWarning = error instanceof Error ? error.message : "Не удалось прочитать технические метаданные.";
            warningReasons.set(item.indexWarning, (warningReasons.get(item.indexWarning) ?? 0) + 1);
          }
        }
        accepted.push(item);
      }
      // Guard memory before starting any Cornerstone decoder on an 8 GB Mac.
      const allDicom = [...files, ...accepted].filter((item) => item.kind === "dicom").map((item) => item.file);
      const sizeProblem = allDicom.length ? validateViewerFileSelection(allDicom) : null;
      if (sizeProblem) {
        for (const item of accepted) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        const pending = new Set(accepted.map((item) => item.previewUrl).filter(Boolean));
        allocatedUrls.current = allocatedUrls.current.filter((url) => !pending.has(url));
        setNotice(`DICOM не добавлены: ${sizeProblem}`);
        return;
      }
      if (accepted.length) {
        setFiles((prev) => [...prev, ...accepted]);
        setActiveId(accepted[0].id);
        setZoom(1);
        if (accepted.some((item) => item.kind === "dicom" || item.kind === "nifti")) setModality("КТ / МРТ — уточнить");
        const commonReason = [...warningReasons.entries()].sort((a, b) => b[1] - a[1])[0];
        const details = commonReason ? ` Основная причина (${commonReason[1]}): ${commonReason[0]}` : "";
        setNotice(`${accepted.length} файл(ов) добавлено локально.${duplicates ? ` Повторно выбранных, уже загруженных файлов: ${duplicates}.` : ""}${rejected ? ` Неподдерживаемых: ${rejected}.` : ""}${warningCount ? ` Не удалось индексировать DICOM: ${warningCount}.${details}` : ""}`);
      } else setNotice(rejected ? "Поддерживаются DICOM, NIfTI, ZIP, JPG, PNG и WEBP." : "Файлы не выбраны.");
    } finally { setIndexing(false); }
  };

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault(); setDragged(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };
  const clearFiles = () => {
    if (indexing) return;
    allocatedUrls.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    allocatedUrls.current = [];
    setDicomPreview(null);
    setFiles([]); setActiveId(null); setZoom(1); setNotice("Список очищен. Файлы на диске не изменены.");
  };
  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);

  return <div className="ora-app">
    <aside className="ora-sidebar">
      <div className="ora-brand"><div className="ora-logo"><Icon name="scan" size={25}/></div><div><strong>OPUS<span>RADIOLOGY</span></strong><small>AI DIAGNOSTIC WORKSPACE</small></div></div>
      <div className="ora-nav-heading">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <div className="ora-nav-current"><Icon name="grid" size={19}/> Обзор исследования <span className="ora-nav-dot" /></div>
      <div className="ora-nav-muted"><Icon name="folder" size={19}/> Архив исследований <span>Скоро</span></div>
      <div className="ora-nav-muted"><Icon name="brain" size={19}/> Центр AI-анализа <span>Скоро</span></div>
      <div className="ora-nav-muted"><Icon name="layers" size={19}/> 3D-лаборатория <span>Скоро</span></div>
      <div className="ora-nav-heading ora-nav-spaced">ПЛАТФОРМА</div>
      <div className="ora-nav-muted"><Icon name="clipboard" size={19}/> Отчёты <span>Скоро</span></div>
      <div className="ora-nav-muted"><Icon name="settings" size={19}/> Настройки <span>Скоро</span></div>
      <div className="ora-sidebar-bottom"><div className="ora-device-mark"><span className="ora-status-dot"/> Локальный режим</div><p>На этом этапе изображения не передаются в облачные сервисы.</p><div className="ora-version">LOCAL PREVIEW · 1.7.0</div></div>
    </aside>

    <main className="ora-main">
      <header className="ora-topbar"><div className="ora-breadcrumb">Рабочая станция <span>/</span> Новое исследование</div><div className="ora-topbar-right"><span className="ora-header-pill"><span className="ora-status-dot"/> Интерфейс запущен</span><span className="ora-header-chip">M1 · DEV</span><div className="ora-avatar">OR</div></div></header>
      <div className="ora-content">
        <div className="ora-heading"><div><div className="ora-eyebrow"><span className="ora-eyebrow-line"/> RADIOLOGY INTELLIGENCE PLATFORM</div><h1>Рабочая станция <em>КТ / МРТ</em></h1><p>Исследование, визуализация и клинический контекст — в одном пространстве.</p></div><span className="ora-preview-label"><Icon name="info" size={15}/> Единая рабочая станция · β</span></div>

        <div className="ora-pipeline">
          <div className="ora-pipeline-step ora-pipeline-active"><span className="ora-step-number">01</span><div><strong>Загрузка исследования</strong><small>Локальные файлы</small></div><Icon name="check" size={16}/></div>
          <div className="ora-pipeline-divider"/>
          <div className="ora-pipeline-step"><span className="ora-step-number">02</span><div><strong>Медицинские модели</strong><small>Пилот проверен · интеграция далее</small></div></div>
          <div className="ora-pipeline-divider"/>
          <div className="ora-pipeline-step"><span className="ora-step-number">03</span><div><strong>Клинический синтез</strong><small>Gemini → JSON → GPT / Claude</small></div></div>
        </div>

        <div className="ora-workgrid">
          <section className="ora-left-col">
            <div className="ora-card ora-upload-card">
              <div className="ora-section-title"><div><span className="ora-heading-icon"><Icon name="folder" size={19}/></span><div><h2>Новое исследование</h2><p>Подготовьте данные для анализа</p></div></div><span className="ora-label-soft">ШАГ 01</span></div>
              <div className={`ora-dropzone ${dragged ? "ora-drop-active" : ""}`} onDragOver={(event) => {event.preventDefault(); setDragged(true);}} onDragLeave={() => setDragged(false)} onDrop={onDrop}>
                <div className="ora-upload-icon"><Icon name="upload" size={26}/></div><strong>Перетащите медицинские изображения</strong><p>или выберите файлы на вашем устройстве</p>
                <button className="ora-primary-button" type="button" disabled={indexing} onClick={() => inputRef.current?.click()}><Icon name="plus" size={17}/> {indexing ? "Читаем заголовки..." : "Выбрать файлы"}</button>
                <button className="ora-folder-button" type="button" disabled={indexing} onClick={() => folderRef.current?.click()}>Выбрать папку DICOM</button>
                <input ref={folderRef} type="file" className="ora-hidden-input" multiple {...{webkitdirectory: "", directory: ""}} onChange={pickFiles} />
                <input ref={inputRef} className="ora-hidden-input" type="file" accept=".dcm,.dicom,.zip,.nii,.gz,.png,.jpg,.jpeg,.webp" multiple onChange={pickFiles}/>
                <div className="ora-accepted">DICOM · NIfTI · ZIP · PNG · JPEG · WEBP</div>
              </div>
              {notice && <div className="ora-notice" role="status"><Icon name="info" size={16}/>{notice}</div>}
              <div className="ora-fields"><label>Название исследования<input value={studyName} onChange={e => setStudyName(e.target.value)} placeholder="Например, МРТ головного мозга" /></label><label>Модальность<select value={modality} onChange={e=>setModality(e.target.value)}><option>Не определена</option><option>КТ</option><option>МРТ</option><option>КТ / МРТ — уточнить</option></select></label></div>
              <div className="ora-files-head"><strong>Файлы исследования <span>{files.length}</span></strong>{files.length > 0 && <button type="button" className="ora-link-danger" disabled={indexing} onClick={clearFiles}><Icon name="trash" size={14}/> Очистить список</button>}</div>
              <div className="ora-file-list">{files.length === 0 ? <div className="ora-files-empty">Пока не загружено ни одного файла</div> : files.slice(0, 12).map(item => <button type="button" className={`ora-file-row ${activeId === item.id ? "ora-file-selected" : ""}`} key={item.id} onClick={()=> {setActiveId(item.id); setZoom(1);}}><Icon name="file" size={17}/><span className="ora-file-name" title={item.file.name}>{item.file.name}</span><small>{kindLabel[item.kind]}</small><small>{formatSize(item.file.size)}</small></button>)}{files.length > 12 && <div className="ora-more-files">Ещё {files.length - 12} файлов в исследовании</div>}</div>
              {series.length > 0 && <div className="ora-series-panel"><label htmlFor="ora-series-choice">DICOM-серии · {series.length}</label>
                <select id="ora-series-choice" value={activeSeries?.key ?? ""} onChange={(e) => {
                  const found = series.find((g) => g.key === e.target.value);
                  if (found?.members[0]) { setActiveId(found.members[0].id); setZoom(1); }
                }}><option value="">Выберите серию</option>{series.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select>
                {activeSeries && <>
                  <p className="ora-series-summary">{activeSeries.members.length} файл(ов) · {activeSeries.modality || "DICOM"}</p>
                  <p className={activeSeries.spatiallySorted ? "ora-series-ok" : "ora-series-warning"}>
                    {activeSeries.spatiallySorted ? "✓ Срезы отсортированы по DICOM-координатам" : "⚠ Пространственный порядок не подтверждён"}
                  </p>
                  <p className={activeSeries.volumeReady ? "ora-series-ok" : "ora-series-warning"}>
                    {activeSeries.volumeReady
                      ? `✓ Геометрия однородна · шаг ${activeSeries.sliceSpacingMm?.toFixed(2)} мм · подготовлено для будущего 3D-движка`
                      : activeSeries.warning ?? "MPR/3D недоступны без подтверждённого объёма"}
                  </p>
                  <p className={mprCheck.eligible ? "ora-series-ok" : "ora-series-warning"}>MPR: {mprCheck.reason}</p>
                </>}
              </div>}
              <div className="ora-file-summary"><Icon name="shield" size={16}/> Файлы остаются в браузере. Не используйте снимки с персональными данными при тестировании. Размер: {files.length ? formatSize(totalSize) : "0 МБ"}</div>
            </div>
          </section>

          <section className="ora-center-col">
            <div className="ora-viewer-card">
              <div className="ora-viewer-head">
                <div><span className="ora-heading-icon ora-heading-icon-dark"><Icon name="scan" size={18}/></span><div><h2>Просмотр изображения</h2><p>{hasCornerstone ? `${activeSeries?.label ?? "DICOM"} · Cornerstone3D` : active ? active.file.name : "Нет выбранного исследования"}</p></div></div>
                {hasCornerstone ? <div className="ora-mode-actions"><span className="ora-viewer-engine">DICOM · {cornerstoneFiles.length} кадр(ов)</span><div className="ora-mode-buttons" role="group" aria-label="Режим просмотра"><button type="button" className={viewMode === "2d" ? "ora-mpr-toggle active" : "ora-mpr-toggle"} aria-pressed={viewMode === "2d"} onClick={() => setViewMode("2d")}>2D</button><button type="button" className={viewMode === "mpr" ? "ora-mpr-toggle active" : "ora-mpr-toggle"} aria-pressed={viewMode === "mpr"} disabled={!mprCheck.eligible} title={mprCheck.reason} onClick={() => setViewMode("mpr")}>MPR · 3 плоскости</button><button type="button" className={viewMode === "3d" ? "ora-mpr-toggle active" : "ora-mpr-toggle"} aria-pressed={viewMode === "3d"} disabled={!mprCheck.eligible} title={mprCheck.reason} onClick={() => setViewMode("3d")}>3D · Объём</button></div></div> :
                <div className="ora-viewer-tools"><button type="button" title="Уменьшить" disabled={!url} onClick={()=>setZoom(z=>Math.max(.5,Number((z-.25).toFixed(2))))}><Icon name="minus" size={17}/></button><span>{Math.round(zoom*100)}%</span><button type="button" title="Увеличить" disabled={!url} onClick={()=>setZoom(z=>Math.min(4,Number((z+.25).toFixed(2))))}><Icon name="plus" size={17}/></button><button type="button" title="Сбросить масштаб" disabled={!url} onClick={()=>setZoom(1)}><Icon name="fit" size={17}/></button></div>}
              </div>
              {hasCornerstone && !mprCheck.eligible && <div className="ora-mpr-blocker" role="status">
                <div><strong>MPR и 3D недоступны для выбранной серии ({cornerstoneFiles.length} кадров).</strong>
                  <p>{mprCheck.reason} Другие серии того же исследования могут иметь подходящую геометрию.</p></div>
                {compatibleAlternative?.members[0] && <button type="button" onClick={() => {
                  setActiveId(compatibleAlternative.members[0].id); setViewMode("2d"); setZoom(1);
                }}>Открыть подходящую серию: {compatibleAlternative.label}</button>}
              </div>}
              {hasCornerstone ?
                <div className="ora-cornerstone-host">{showMpr
                  ? <CornerstoneMPR key={`mpr-${activeSeries!.key}`} files={cornerstoneFiles} sourceSeries={activeSeries!} quality={mprQuality} show3D={viewMode === "3d"} onShow3DChange={enabled => setViewMode(enabled ? "3d" : "mpr")}/>
                  : <CornerstoneStack key={activeSeries!.key} files={cornerstoneFiles} selectedIndex={sliceIndex >= 0 ? sliceIndex : 0} modality={activeSeries!.modality} onSliceChange={(index) => { const member = activeSeries!.members[index]; if (member) setActiveId(member.id); }}/>}</div>
                : <>
                  <div className="ora-viewer-body" tabIndex={0}>
                    {url && active ? <div className="ora-image-scroll"><img src={url} alt={`Предпросмотр: ${active.file.name}`} className="ora-medical-img" style={{transform: `scale(${zoom})`}} /></div>
                    : <div className="ora-viewer-placeholder"><div className="ora-rings"><span className="ora-ring-a"/><span className="ora-ring-b"/><span className="ora-ring-c"/><div className="ora-crosshair">+</div></div><div className="ora-viewer-empty-icon"><Icon name={active ? "file" : "scan"} size={27}/></div><h3>{active ? "Файл добавлен в исследование" : "Область медицинских изображений"}</h3><p>{active ? dicomLoading ? "Читаем DICOM локально…" : (dicomError || active.indexWarning || "Формат пока нельзя отобразить. NIfTI/ZIP требуют отдельного движка.") : "Загрузите изображение JPG/PNG или DICOM-серию. Снимки появятся здесь без отправки в облако."}</p></div>}
                    <div className="ora-viewer-axis"><span>IMAGING / LOCAL VIEW</span><span>{url ? "ЛОКАЛЬНЫЙ ПРОСМОТР" : "ОЖИДАНИЕ ДАННЫХ"}</span></div>
                  </div>
                </>}
              <div className="ora-viewer-footer"><span><span className="ora-tiny-dot"/> {hasCornerstone ? "Cornerstone3D · локальный экспериментальный просмотр" : dicomPreview?.id === activeId ? `${dicomPreview.metadata.modality || "DICOM"} · ${dicomPreview.metadata.width}×${dicomPreview.metadata.height} · WC ${dicomPreview.metadata.windowCenter ?? "auto"} / WW ${dicomPreview.metadata.windowWidth ?? "auto"}` : "Локальный предпросмотр · исследовательский режим"}</span><span>3D MIP / MPR <b>{mprCheck.eligible ? "экспериментальные" : "недоступны"}</b></span></div>
            </div>
            <div className="ora-finding-strip"><div className="ora-finding-icon"><Icon name="sparkles" size={21}/></div><div><strong>AI-анализ готов к интеграции</strong><p>Готовые NIfTI-маски можно импортировать в MPR уже сейчас. Автоматические модели пока не подключены.</p></div><span className="ora-coming-soon">НЕ ПОДКЛЮЧЁН</span></div>
          </section>

          <section className="ora-right-col">
            <div className="ora-card ora-context-card"><div className="ora-section-title"><div><span className="ora-heading-icon"><Icon name="clipboard" size={18}/></span><div><h2>Клинический контекст</h2><p>Данные для интерпретации</p></div></div></div><label className="ora-context-label" htmlFor="clinical-context">Жалобы, анамнез, лабораторные данные</label><textarea id="clinical-context" value={context} onChange={e=>setContext(e.target.value)} placeholder="Например: пациент 54 лет, головные боли в течение 3 недель. Цель исследования — исключить структурную патологию..." rows={8} /><div className="ora-context-tip"><Icon name="info" size={16}/><p>Контекст пока хранится только в памяти страницы. Не вводите идентифицирующие данные реальных пациентов при тестировании.</p></div></div>
            <div className="ora-card ora-analysis-card"><AiWorkflowPanel series={series}/></div>
          </section>
        </div>
        <footer className="ora-footer"><span>OPUS RADIOLOGY AI · v1.7.0 · LOCAL DEVELOPMENT</span><span>Исследовательский прототип · не для клинической диагностики · <a href="/viewer">Техническая лаборатория DICOM</a></span></footer>
      </div>
    </main>
  </div>;
}
