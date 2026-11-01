/** Prefer a verifiable, runnable ORIGINAL DICOM volume over a scout/localizer.
 * This only chooses the first displayed series. It never starts inference,
 * guesses missing anatomy, approves cloud transfer, or overrides manual choice.
 */
import type {DicomSeries} from "./dicom-series.ts";
import {planNativeStudyAnalysis} from "./unified-study-dispatch.ts";
import {assessAutomaticBrainFlair} from "./automatic-brain-flair.ts";
import {planVisionFrameSamples} from "./vision-frame-plan.ts";

export type PrimarySeriesSuggestion={
 key:string|null;
 runnable:boolean;
 /** A source-verified CT/MR preview is available without a native detector. */
 visionOnly:boolean;
 ambiguity:boolean;
 reason:string;
};
export function suggestPrimaryDicomSeries(series:readonly DicomSeries[],
 availableFiles:ReadonlySet<string>):PrimarySeriesSuggestion{
 if(series.length===0)return {key:null,runnable:false,visionOnly:false,ambiguity:false,reason:"Нет DICOM-серий."};
 const ranked=series.map((s,index)=>{
  const plan=planNativeStudyAnalysis(s,availableFiles);
  const complete=s.members.length>0&&s.members.every(m=>availableFiles.has(m.id));
  const native=complete&&s.members.every(m=>m.metadata.imageRole!=="DERIVED"&&
   m.metadata.imageRole!=="LOCALIZER");
  const executable=plan.route!==null;
  // An unsupported anatomy can still have a verified independent Vision path.
  // Reuse the strict UID/physical geometry gate and require every source file.
  const visionOnly=!executable&&complete&&canAutoPrepareLocalVision(s);
  // Never prefer an incomplete series or a scout merely because it has many files.
  // A modest original diagnostic stack is preferable to an oversized reconstruction.
  const size=Math.min(s.members.length,300);
  // Prefer a geometry-verified long-inversion brain FLAIR among otherwise
  // eligible native MRI series; preserve the CT/MR Vision-only fallback.
  const sourceFlair=executable&&complete&&plan.route==="wmh-flair"&&
    assessAutomaticBrainFlair(s).eligible;
  const score=(executable?100000:visionOnly?50000:0)+(native?10000:0)+
   (sourceFlair?25000:0)+
   (s.volumeReady&&s.spatiallySorted?1000:0)+
   (complete?500:0)+size;
  return {s,index,plan,native,executable,visionOnly,score};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const best=ranked[0];
 const viable=ranked.filter(item=>item.executable||item.visionOnly);
 const studies=new Set(viable.map(item=>item.s.members[0]?.metadata.studyUid).filter(Boolean));
 const ambiguity=viable.length>1||studies.size>1;
 return {
  key:best.s.key,runnable:best.executable,visionOnly:best.visionOnly,ambiguity,
  reason:best.executable?
   (ambiguity?"Автоматически выбрана серия для оригинального детектора; доступны другие диагностические серии. Проверьте выбор.":
    "Автоматически выбрана исходная диагностическая серия для оригинального детектора."):
   best.visionOnly?
   (ambiguity?"Автоматически выбрана серия для локального Gemini/Opus без патологического детектора; есть другие подходящие серии. Проверьте выбор.":
    "Автоматически выбрана исходная серия для локального Gemini/Opus без патологического детектора. Облачная передача требует отдельного разрешения."):
   "Достоверно совместимая серия не найдена. Выбрана лучшая для просмотра; диагноз и маршрут не определены.",
 };
}

/** Local image planning needs no provider account or image-transfer consent.
 * Unverified scouts, reconstructions and incomplete geometry cannot be
 * silently sent to Vision; this gate NEVER permits an external request.
 */
export function canAutoPrepareLocalVision(series:DicomSeries|undefined):boolean{
 if(!series||(series.modality!=="CT"&&series.modality!=="MR")||
    !series.volumeReady||!series.spatiallySorted||series.members.length<2||
    series.members.some(m=>m.metadata.imageRole==="LOCALIZER"||
      m.metadata.imageRole==="DERIVED"))return false;
 // Use the same source, SOP and physical geometry validation as the preview
 // planner. A panel must not auto-open for a source that cannot be decoded.
 return planVisionFrameSamples([series],series.key).status==="ready-for-local-preview";
}

/** On original CT/MR without an installed compatible specialty route, the
 * physician can still open a LOCAL Vision plan from the primary action.
 * This is NOT an inference result, clinical conclusion or cloud approval.
 */
export function canUseVisionOnlyAsPrimary(series:DicomSeries|undefined,
 availableFiles:ReadonlySet<string>):boolean{
 return !!series&&series.members.every(m=>availableFiles.has(m.id))&&
  planNativeStudyAnalysis(series,availableFiles).route===null&&
  canAutoPrepareLocalVision(series);
}
