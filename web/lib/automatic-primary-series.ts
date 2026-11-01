/** Prefer a verifiable, runnable ORIGINAL DICOM volume over a scout/localizer.
 * This only chooses the first displayed series. It never starts inference,
 * guesses missing anatomy, approves cloud transfer, or overrides manual choice.
 */
import type {DicomSeries} from "./dicom-series.ts";
import {planNativeStudyAnalysis} from "./unified-study-dispatch.ts";
import {planVisionFrameSamples} from "./vision-frame-plan.ts";

export type PrimarySeriesSuggestion={
 key:string|null;
 runnable:boolean;
 ambiguity:boolean;
 reason:string;
};
export function suggestPrimaryDicomSeries(series:readonly DicomSeries[],
 availableFiles:ReadonlySet<string>):PrimarySeriesSuggestion{
 if(series.length===0)return {key:null,runnable:false,ambiguity:false,reason:"Нет DICOM-серий."};
 const ranked=series.map((s,index)=>{
  const plan=planNativeStudyAnalysis(s,availableFiles);
  const complete=s.members.length>0&&s.members.every(m=>availableFiles.has(m.id));
  const native=complete&&s.members.every(m=>m.metadata.imageRole!=="DERIVED"&&
   m.metadata.imageRole!=="LOCALIZER");
  const executable=plan.route!==null;
  // Never prefer an incomplete series or a scout merely because it has many files.
  // A modest original diagnostic stack is preferable to an oversized reconstruction.
  const size=Math.min(s.members.length,300);
  const score=(executable?100000:0)+(native?10000:0)+
   (s.volumeReady&&s.spatiallySorted?1000:0)+
   (complete?500:0)+size;
  return {s,index,plan,native,executable,score};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const best=ranked[0];
 const viable=ranked.filter(item=>item.executable);
 const studies=new Set(viable.map(item=>item.s.members[0]?.metadata.studyUid).filter(Boolean));
 const ambiguity=viable.length>1||studies.size>1;
 return {
  key:best.s.key,runnable:best.executable,ambiguity,
  reason:best.executable?
   (ambiguity?"Автоматически выбрана подходящая серия; доступны другие диагностические серии. Проверьте выбор.":
    "Автоматически выбрана исходная диагностическая серия для единого анализа."):
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
