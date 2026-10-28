"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { groupDicomSeries, readDicomSeriesHeader, type DicomSeries } from "../../lib/dicom-series";
import { validateViewerFileSelection } from "../../lib/viewer-limits";
import "./viewer.css";
import type {WorkerSession} from "../../lib/local-worker";

const NoduleBoundResearchView = dynamic(() => import("../../components/NoduleBoundResearchView"), {ssr:false});
const DirectIchDicomDetector = dynamic(() => import("../../components/DirectIchDicomDetector"), {ssr:false});
const NativeCtResearchExport = dynamic(() => import("../../components/NativeCtResearchExport"), {ssr:false});

const NiftiCtResearchView = dynamic(() => import("../../components/NiftiCtResearchView"), {
  ssr: false,
  loading: () => <div className="cs-placeholder">Загрузка локального NIfTI CT review…</div>,
});

const LungNoduleResearchResults = dynamic(() => import("../../components/LungNoduleResearchResults"), {ssr:false});
const ChestEffusionResearchResults = dynamic(() => import("../../components/ChestEffusionResearchResults"), {ssr:false});
const IldGgoExpertResearch = dynamic(() => import("../../components/IldGgoExpertResearch"), {ssr:false});
const IldPatternResearch = dynamic(() => import("../../components/IldPatternResearch"), {ssr:false});
const ChestExtraPulmonaryResearch = dynamic(() => import("../../components/ChestExtraPulmonaryResearch"), {ssr:false});
const ThoracicMassResearch = dynamic(() => import("../../components/ThoracicMassResearch"), {ssr:false});
const ColonCancerResearchResults = dynamic(() => import("../../components/ColonCancerResearchResults"), {ssr:false});
const PathologyCoverageResearch = dynamic(() => import("../../components/PathologyCoverageResearch"), {ssr:false});
const MorphometryEvidenceReview = dynamic(() => import("../../components/MorphometryEvidenceReview"), {ssr:false});

const RenalCalculusResearchEvidence = dynamic(() => import("../../components/RenalCalculusResearchEvidence"), {ssr:false});
const RenalNeoplasmThreePhaseEvidence = dynamic(() => import("../../components/RenalNeoplasmThreePhaseEvidence"), {ssr:false});
const KiTS23RenalTumorEvidence = dynamic(() => import("../../components/KiTS23RenalTumorEvidence"), {ssr:false});
const RenalCystResearchEvidence = dynamic(() => import("../../components/RenalCystResearchEvidence"), {ssr:false});
const FumpePeResearchEvidence = dynamic(() => import("../../components/FumpePeResearchEvidence"), {ssr:false});
const LungscapePhysicianEvidencePanel = dynamic(() => import("../../components/LungscapePhysicianEvidencePanel"), {ssr:false});

const CornerstoneStack = dynamic(() => import("../../components/CornerstoneStack"), {
  ssr: false,
  loading: () => <div className="cs-placeholder">Загрузка Cornerstone3D…</div>,
});

type Indexed = { id: string; file: File; header: Awaited<ReturnType<typeof readDicomSeriesHeader>> };

export default function ViewerPage() {
  const folderPicker = useRef<HTMLInputElement>(null);
  const [sourceMode,setSourceMode] = useState<"dicom"|"nifti"|"nodules"|"colon"|"coverage"|"morphometry">("dicom");
  const [indexed, setIndexed] = useState<Indexed[]>([]);
  const [currentSeriesKey, setCurrentSeriesKey] = useState("");
  const [preparedMonaiSource,setPreparedMonaiSource]=useState<File|null>(null);
  const [preparedMonaiSession,setPreparedMonaiSession]=useState<WorkerSession|null>(null);
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
      setPreparedMonaiSource(null);setPreparedMonaiSession(null);
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
      <div className="cs-source-mode" aria-label="Формат исходной серии">
        <button type="button" className={sourceMode==="dicom"?"active":""}
          onClick={()=>setSourceMode("dicom")}>DICOM · исходные серии</button>
        <button type="button" className={sourceMode==="nodules"?"active":""}
          onClick={()=>setSourceMode("nodules")}>MONAI · узлы КТ</button>
        <button type="button" className={sourceMode==="nifti"?"active":""}
          onClick={()=>setSourceMode("nifti")}>NIfTI · КТ брюшной полости</button>
        <button type="button" className={sourceMode==="colon"?"active":""}
          onClick={()=>setSourceMode("colon")}>VISTA3D · опухоль толстой кишки</button>
        <button type="button" className={sourceMode==="coverage"?"active":""}
          onClick={()=>setSourceMode("coverage")}>Покрытие патологий · доказательства</button>
        <button type="button" className={sourceMode==="morphometry"?"active":""}
          onClick={()=>setSourceMode("morphometry")}>Морфометрия · 8 модулей</button>
      </div>
      {sourceMode==="nodules" ? <NoduleBoundResearchView initialSource={preparedMonaiSource} initialAutoSession={preparedMonaiSession}/> : sourceMode==="nifti" ? <NiftiCtResearchView/> : sourceMode==="colon" ? <ColonCancerResearchResults/> : sourceMode==="coverage" ? <PathologyCoverageResearch/> : sourceMode==="morphometry" ? <MorphometryEvidenceReview/> : <>
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
          <LungNoduleResearchResults key={selected?.key ?? "empty"} isChestCT={!!selected && selected.modality==="CT" && selected.members.every(m=>m.metadata.bodyRegion==="CHEST")}/>
          <ChestEffusionResearchResults key={"fluid-"+(selected?.key??"empty")} isChestCT={!!selected && selected.modality==="CT" && selected.members.every(m=>m.metadata.bodyRegion==="CHEST")}/>
          <IldGgoExpertResearch key={"ild-"+(selected?.key??"empty")} isChestCT={!!selected && selected.modality==="CT" && selected.members.every(m=>m.metadata.bodyRegion==="CHEST")}/>
          <LungscapePhysicianEvidencePanel />
          <FumpePeResearchEvidence />
          <RenalCystResearchEvidence />
          <KiTS23RenalTumorEvidence />
          <RenalNeoplasmThreePhaseEvidence />
          <RenalCalculusResearchEvidence />
          <IldPatternResearch key={"ild-pattern-"+(selected?.key??"empty")} isChestCT={!!selected && selected.modality==="CT" && selected.members.every(m=>m.metadata.bodyRegion==="CHEST")}/>
          <ChestExtraPulmonaryResearch key={"chest-extra-"+(selected?.key??"empty")} isChestCT={!!selected && selected.modality==="CT" && selected.members.every(m=>m.metadata.bodyRegion==="CHEST")}/>
          <ThoracicMassResearch key={"intrathoracic-masses-"+(selected?.key??"empty")} series={selected??null}/>
          {selected && selected.modality==="CT" && selected.members.every(m=>m.metadata.bodyRegion==="HEAD") && <DirectIchDicomDetector key={"ich-"+selected.key} series={selected} files={indexedById}/>}
          {selected && <NativeCtResearchExport key={"native-export-"+selected.key} series={selected} files={selectedFiles} onPreparedSource={(file,session)=>{setPreparedMonaiSession(session??null);setPreparedMonaiSource(file);setSourceMode("nodules");}}/> }
          <button type="button" className="cs-clear" disabled={reading || indexed.length === 0} onClick={() => { setIndexed([]); setPreparedMonaiSource(null);setPreparedMonaiSession(null); setCurrentSeriesKey(""); setMessage("Список очищен, файлы на диске не изменены."); }}>Очистить загруженное</button>
        </aside>
        <div className="cs-stage">
          {selectedFiles.length ? <CornerstoneStack key={selected?.key} files={selectedFiles} modality={selected?.modality}/> : <div className="cs-placeholder"><span>✚</span><strong>Область DICOM-изображений</strong><p>Выберите файлы или папку DICOM, чтобы проверить работу Cornerstone3D.</p></div>}
          <div className="cs-bottom-note">Важное ограничение: 2D-просмотр не означает подтверждение точности измерений, реконструкции, правильной геометрии или отсутствия патологии. Сжатые кодеки проверяются отдельно на тестовых наборах.</div>
        </div>
      </div>
      </>}
    </div>
  </main>;
}
