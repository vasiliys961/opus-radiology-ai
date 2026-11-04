"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {checkMprEligibility} from "../../lib/mpr-eligibility";
import {assessMprQuality} from "../../lib/mpr-quality";
import { groupDicomSeries, readDicomSeriesHeader, type DicomSeries } from "../../lib/dicom-series";
import {suggestPrimaryDicomSeries} from "../../lib/automatic-primary-series";
import { validateViewerFileSelection } from "../../lib/viewer-limits";
import "./viewer.css";
import "../radiology.css";
import {AnalysisSoundProvider} from "../../components/AnalysisSoundProvider";
import DetectorAvailabilityGuide from "../../components/DetectorAvailabilityGuide";
import WorkspaceNavigation from "../../components/WorkspaceNavigation";
import type {WorkerSession} from "../../lib/local-worker";
import type {BoundNoduleReport} from "../../lib/live-nodule-report";
import type {SanitizedDetectorBundle} from "../../lib/detector-consilium-evidence";
import type {ClnVerifiedLocalEvidence} from "../../lib/cln-physician-local-review";

const NoduleBoundResearchView = dynamic(() => import("../../components/NoduleBoundResearchView"), {ssr:false});
const WmhSourceReview = dynamic(() => import("../../components/WmhSourceReview"), {ssr:false});
const VisionFramePlanningPanel = dynamic(() => import("../../components/VisionFramePlanningPanel"), {ssr:false});
const UnifiedDicomStudyAnalysis = dynamic(() => import("../../components/UnifiedDicomStudyAnalysis"), {ssr:false});
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

const CornerstoneMPR = dynamic(() => import("../../components/CornerstoneMPR"), {
  ssr:false,loading:()=> <div className="cs-placeholder">Подготовка трёхмерного просмотра…</div>,
});
const CornerstoneStack = dynamic(() => import("../../components/CornerstoneStack"), {
  ssr: false,
  loading: () => <div className="cs-placeholder">Загрузка Cornerstone3D…</div>,
});

type Indexed = { id: string; file: File; header: Awaited<ReturnType<typeof readDicomSeriesHeader>> };

export default function ViewerPage() {
  const [clientReady,setClientReady]=useState(false);
  useEffect(()=>setClientReady(true),[]);
  const folderPicker = useRef<HTMLInputElement>(null);
  const [sourceMode,setSourceMode] = useState<"dicom"|"nifti"|"nodules"|"colon"|"coverage"|"morphometry">("dicom");
  const [indexed, setIndexed] = useState<Indexed[]>([]);
  const [currentSeriesKey, setCurrentSeriesKey] = useState("");
  const [wmhSlice,setWmhSlice]=useState<number|undefined>(undefined);
  const [displayWindow,setDisplayWindow]=useState<{width:number;center:number;nonce:number}|null>(null);
  const [viewMode,setViewMode]=useState<"2d"|"mpr"|"3d">("2d");
  const [visionOpen,setVisionOpen]=useState(false);
  const [researchOpen,setResearchOpen]=useState(false);
  const [researchMode,setResearchMode]=useState(false);
  useEffect(()=>{setResearchMode(new URLSearchParams(window.location.search).get("research")==="1");},[]);
  const [visionFromPrimary,setVisionFromPrimary]=useState(false);
  const [primaryStage,setPrimaryStage]=useState<{seriesKey:string;stage:"running"|"completed"|"vision-only"|"cancelled"}|null>(null);
  const [visionDetectorEvidence,setVisionDetectorEvidence]=useState<{seriesKey:string;bundle:SanitizedDetectorBundle}|null>(null);
  const [clnVerified,setClnVerified]=useState<{seriesKey:string;value:ClnVerifiedLocalEvidence}|null>(null);
  const [preparedMonaiSource,setPreparedMonaiSource]=useState<File|null>(null);
  const [preparedMonaiSession,setPreparedMonaiSession]=useState<WorkerSession|null>(null);
  const [preparedMonaiResult,setPreparedMonaiResult]=useState<BoundNoduleReport|null>(null);
  const [message, setMessage] = useState("Выберите папку с DICOM-файлами или набор отдельных файлов.");
  const [reading, setReading] = useState(false);

  const series = useMemo(() => groupDicomSeries(indexed.map((item) => ({ id: item.id, name: item.file.name, metadata: item.header }))), [indexed]);
  const suggestion=useMemo(()=>suggestPrimaryDicomSeries(series,
    new Set(indexed.map(item=>item.id))),[series,indexed]);
  const selected: DicomSeries | undefined =
    series.find(item=>item.key===(currentSeriesKey||suggestion.key)) ?? series[0];
  const visionSeries = useMemo(()=>selected?[selected]:[],[selected]);
  const indexedById = useMemo(() => new Map(indexed.map((item) => [item.id, item.file])), [indexed]);
  const selectedFiles = useMemo(() => selected?.members.map((item) => indexedById.get(item.id)).filter((file): file is File => !!file) ?? [], [selected, indexedById]);
  const mprCheck=useMemo(()=>checkMprEligibility(selected??null,selectedFiles.map(file=>file.size)),[selected,selectedFiles]);
  const mprQuality=useMemo(()=>assessMprQuality(selected??null),[selected]);
  useEffect(()=>setViewMode("2d"),[selected?.key]);

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
      setPreparedMonaiSource(null);setPreparedMonaiSession(null);setPreparedMonaiResult(null);
      setWmhSlice(undefined);setViewMode("2d");setCurrentSeriesKey("");
      // Pick and validate the newly loaded source before opening local Vision.
      // A scout, mixed study or incomplete geometry must not auto-open a
      // misleading panel; this does not authorize any provider transfer.
      const loadedSeries=groupDicomSeries(parsed.map(item=>({
        id:item.id,name:item.file.name,metadata:item.header,
      })));
      const primary=suggestPrimaryDicomSeries(loadedSeries,
        new Set(parsed.map(item=>item.id)));
      setVisionOpen(false); // No AI workbench until the physician requests analysis.
      setVisionFromPrimary(false);setPrimaryStage(null);setVisionDetectorEvidence(null);setClnVerified(null);
      const mostCommon = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
      setMessage(`Проиндексировано ${parsed.length} DICOM; пропущено ${rejected}.${mostCommon ? ` Основная причина (${mostCommon[1]}): ${mostCommon[0]}.` : ""} Изображения остаются на вашем Mac.`);
    } finally { setReading(false); }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void loadFiles(event.target.files);
    event.target.value = "";
  }

  return <main className="cs-page">
    <header className="cs-top"><a href="/viewer" aria-label="Opus Radiology AI — исследование">OPUS RADIOLOGY</a><WorkspaceNavigation active={researchMode?"technical":"viewer"}/><span>Локальный режим</span></header>
    <div className="cs-container">
      {researchMode&&<details className="cs-geometry" aria-label="Исследовательские модули"><summary>Дополнительные исследовательские инструменты</summary>
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
      </details>}
      {sourceMode==="nodules" ? <NoduleBoundResearchView initialSource={preparedMonaiSource} initialAutoSession={preparedMonaiSession} initialCompletedReport={preparedMonaiResult}/> : sourceMode==="nifti" ? <NiftiCtResearchView/> : sourceMode==="colon" ? <ColonCancerResearchResults/> : sourceMode==="coverage" ? <PathologyCoverageResearch/> : sourceMode==="morphometry" ? <MorphometryEvidenceReview/> : <>
      <div className="cs-intro"><div><h1>Исследование КТ / МРТ</h1><p>Загрузите DICOM, просмотрите изображения или нажмите «Анализировать исследование».</p></div></div>
      {visionFromPrimary&&<p role="status" className="cs-message">
        {primaryStage?.stage==="running"?"Идёт анализ исследования…":
          primaryStage?.stage==="cancelled"?"Анализ остановлен.":
          "Результаты анализа появятся под изображениями."}
      </p>}
      <div className="cs-layout">
        <aside className="cs-sidebar">
          <h2>Загрузить DICOM</h2>
          <p>Учебные или разрешённые обезличенные снимки.</p>
          <label className="cs-picker">Выбрать DICOM-файлы <input type="file" multiple accept=".dcm,.dicom,application/dicom" onChange={onPick} disabled={reading||!clientReady}/></label>
          <button type="button" className="cs-outline" disabled={reading||!clientReady} onClick={() => {
            if (folderPicker.current) {
              (folderPicker.current as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
              folderPicker.current.click();
            }
          }}>Выбрать папку DICOM</button>
          <input ref={folderPicker} type="file" className="cs-hidden" multiple onChange={onPick} disabled={reading||!clientReady}/>
          <div className="cs-message" role="status">{reading ? "Идёт индексация…" : message}</div>
          {series.length > 0 && <>
            <h3>Серии ({series.length})</h3>
            
            <div className="cs-series-list">{series.map((s) => <button type="button" className={selected?.key === s.key ? "cs-series active" : "cs-series"} key={s.key} onClick={() => {setWmhSlice(undefined);setViewMode("2d");setVisionOpen(false);setVisionFromPrimary(false);setPrimaryStage(null);setVisionDetectorEvidence(null);setClnVerified(null);setCurrentSeriesKey(s.key);}}>{s.label}</button>)}</div>
          </>}
          {researchMode&&selected && <details className="cs-geometry"><summary>Сведения об исследовании</summary><h3>Контроль геометрии</h3><p>{selected.spatiallySorted ? "✓ Пространственный порядок подтверждён" : "⚠ Порядок условный"}</p><p>{selected.volumeReady ? `✓ Предварительная геометрия для будущего 3D · ${selected.sliceSpacingMm?.toFixed(2)} мм` : "3D/MPR НЕ РАЗРЕШЕНЫ"}</p>{selected.warning && <p>{selected.warning}</p>}</details>}
          {selected && <UnifiedDicomStudyAnalysis researchMode={researchMode} key={"unified-"+selected.key} series={selected} allSeries={series} files={indexedById}
            onMonaiReady={(file,session,report)=>{setPreparedMonaiSource(file);setPreparedMonaiSession(session);setPreparedMonaiResult(report??null);if(researchMode)setSourceMode("nodules");}}
            onNavigate={setWmhSlice}
            onReadyForVision={key=>{if(selected?.key===key){setVisionFromPrimary(true);setVisionOpen(true);}}}
            onAnalysisStage={(key,stage)=>{if(selected?.key===key)setPrimaryStage({seriesKey:key,stage});}}
            onClnBoundReady={(key,value)=>setClnVerified(previous=>{
              if(key!==selected.key)return previous;
              if(previous?.seriesKey===key&&JSON.stringify(previous.value)===JSON.stringify(value))return previous;
              return {seriesKey:key,value};
            })}
            onDetectorEvidence={(key,bundle)=>setVisionDetectorEvidence(previous=>{
              if(!bundle)return null;
              if(previous?.seriesKey===key&&JSON.stringify(previous.bundle)===JSON.stringify(bundle))
                return previous;
              return {seriesKey:key,bundle};
            })}/>}
          {researchMode&&<details className="cs-geometry" onToggle={event=>setResearchOpen(event.currentTarget.open)}><summary>Дополнительные диагностические инструменты</summary>
          {researchOpen&&<>
          <DetectorAvailabilityGuide compact/>
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
          {selected && selected.modality==="MR" && <WmhSourceReview key={"wmh-"+selected.key} series={selected} files={indexedById} onNavigate={setWmhSlice}/>}
          {selected && <NativeCtResearchExport key={"native-export-"+selected.key} series={selected} files={selectedFiles} onPreparedSource={(file,session)=>{setPreparedMonaiSession(session??null);setPreparedMonaiSource(file);setPreparedMonaiResult(null);setSourceMode("nodules");}}/> }
          </>}
          </details>}
          <button type="button" className="cs-clear" disabled={reading || indexed.length === 0} onClick={() => { setIndexed([]); setPreparedMonaiSource(null);setPreparedMonaiSession(null);setPreparedMonaiResult(null); setCurrentSeriesKey(""); setVisionOpen(false); setVisionFromPrimary(false); setPrimaryStage(null); setVisionDetectorEvidence(null);setClnVerified(null); setMessage("Список очищен, файлы на диске не изменены."); }}>Очистить загруженное</button>
        </aside>
        <div className="cs-stage">
          {selectedFiles.length>0&&<div className="cs-view-modes" role="group" aria-label="Просмотр изображений">
            <button type="button" aria-pressed={viewMode==="2d"} onClick={()=>setViewMode("2d")}>Срезы · 2D</button>
            <button type="button" aria-pressed={viewMode==="mpr"} disabled={!mprCheck.eligible}
              title={mprCheck.eligible?undefined:mprCheck.reason} onClick={()=>setViewMode("mpr")}>Три плоскости</button>
            <button type="button" aria-pressed={viewMode==="3d"} disabled={!mprCheck.eligible}
              title={mprCheck.eligible?undefined:mprCheck.reason} onClick={()=>setViewMode("3d")}>3D · вращение</button>
          </div>}
          {selectedFiles.length>0&&!mprCheck.eligible&&<p role="status">Три плоскости и 3D недоступны: {mprCheck.reason} Это ограничение объёмного просмотра; последовательный анализ выбранных 2D-срезов доступен отдельно.</p>}
          {selectedFiles.length>0&&selected&&viewMode!=="2d"&&mprCheck.eligible?
            <CornerstoneMPR key={"mpr-"+selected.key} files={selectedFiles} sourceSeries={selected}
              quality={mprQuality} show3D={viewMode==="3d"}
              onShow3DChange={enabled=>setViewMode(enabled?"3d":"mpr")}/>:
            selectedFiles.length?
             <CornerstoneStack key={selected?.key} files={selectedFiles} modality={selected?.modality}
               selectedIndex={wmhSlice} onSliceChange={setWmhSlice} displayWindow={displayWindow}/>:
             <div className="cs-placeholder"><span>✚</span><strong>Область DICOM-изображений</strong><p>Выберите файлы или папку DICOM.</p></div>}
          {selected && (selected.modality==="CT"||selected.modality==="MR") && <section className="cs-geometry" aria-label="Подготовка Gemini и Opus по открытому DICOM">
            {visionFromPrimary&&<h3>Описание и заключение</h3>}
            {researchMode&&!visionFromPrimary&&<button type="button" disabled={reading} onClick={()=>setVisionOpen(v=>!v)}>
              {visionOpen?"Закрыть дополнительные инструменты":"Анализировать отдельные срезы"}
            </button>}

            {visionOpen && <AnalysisSoundProvider>
              <VisionFramePlanningPanel key={"vision-"+selected.key} series={visionSeries} comparisonSeries={series}
                activeSeriesKey={selected.key} fileById={indexedById}
                originalDetectorEvidence={visionDetectorEvidence?.seriesKey===selected.key?visionDetectorEvidence.bundle:null}
                 clnVerifiedLocal={clnVerified?.seriesKey===selected.key?clnVerified.value:null}
                fromPrimaryAnalysis={visionFromPrimary}
                researchMode={researchMode}
                primaryActionAvailable={true}
                primaryAnalysisStage={visionFromPrimary&&primaryStage?.seriesKey===selected.key?primaryStage.stage:"idle"}
                onOpenSlice={id=>{
                  const index=selected.members.findIndex(m=>m.id===id);
                  if(index>=0)setWmhSlice(index);
                  else{
                    const owner=series.find(s=>s.members.some(m=>m.id===id));
                    if(owner){setCurrentSeriesKey(owner.key);setWmhSlice(owner.members.findIndex(m=>m.id===id));setViewMode('2d');setVisionOpen(false);setVisionFromPrimary(false);setPrimaryStage(null);setVisionDetectorEvidence(null);setClnVerified(null);}
                  }
                }}
                onInspectFinding={(id,window)=>{
                  const index=selected.members.findIndex(m=>m.id===id);
                  if(index>=0){setViewMode('2d');setWmhSlice(index);if(window)setDisplayWindow({...window,nonce:Date.now()});document.querySelector('.cs-stack')?.scrollIntoView({block:'start',behavior:'smooth'});}
                }}/>
            </AnalysisSoundProvider>}
          </section>}
          {visionFromPrimary&&<div className="cs-bottom-note">Предварительное заключение. Врач проверяет его по исходным снимкам.</div>}
        </div>
      </div>
      </>}
    </div>
  </main>;
}
