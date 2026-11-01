/** Prefer a verifiable, runnable ORIGINAL DICOM volume over a scout/localizer.
 * This only chooses the first displayed series. It never starts inference,
 * guesses missing anatomy, approves cloud transfer, or overrides manual choice.
 */
import type {DicomSeries} from "./dicom-series.ts";
import {planNativeStudyAnalysis} from "./unified-study-dispatch.ts";

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
