/** Route the currently opened native DICOM series to a real, existing local executor.
 * This describes protocol eligibility, NOT installed weights or a completed inference.
 * The authenticated worker independently proves readiness before returning evidence.
 */
import type {DicomSeries} from "./dicom-series.ts";

export type StudyRoute="monai-nodules"|"ianpan-ich"|"wmh-flair";
export type StudyAnalysisPlan={
  route:StudyRoute|null;
  title:string;
  reason:string|null;
  needsExplicitFlair:boolean;
};

export function planNativeStudyAnalysis(series:DicomSeries, availableFiles:ReadonlySet<string>):StudyAnalysisPlan{
  const denied=(reason:string):StudyAnalysisPlan=>({route:null,title:"Нет совместимого исполнительного пути",reason,needsExplicitFlair:false});
  if(!series.members.length)return denied("Серия DICOM пуста.");
  if(!series.volumeReady||!series.spatiallySorted)
    return denied("Нужна исходная серия с подтверждённым пространственным порядком и геометрией.");
  const uids=new Set(series.members.map(m=>m.metadata.seriesUid));
  if(uids.size!==1||uids.has(null)||series.members.some(m=>
      !m.metadata.sopInstanceUid||!m.metadata.studyUid||
      !availableFiles.has(m.id)||
      m.metadata.imageRole==="DERIVED"||m.metadata.imageRole==="LOCALIZER"||
      (m.metadata.numberOfFrames!==null&&m.metadata.numberOfFrames!==1)))
    return denied("Неполная, смешанная, производная или не подтверждённая по UID исходная серия.");
  const allRegion=(region:string)=>series.members.every(m=>m.metadata.bodyRegion===region);
  if(series.modality==="CT"&&allRegion("CHEST"))
    return {route:"monai-nodules",title:"Узлы лёгких · MONAI RetinaNet",reason:null,needsExplicitFlair:false};
  if(series.modality==="CT"&&allRegion("HEAD")){
    if(series.members.length<8||series.members.length>64)
      return denied("ianpan поддерживает только 8–64 среза исходной КТ головы.");
    return {route:"ianpan-ich",title:"Кровоизлияния · ianpan",reason:null,needsExplicitFlair:false};
  }
  if(series.modality==="MR"&&allRegion("HEAD"))
    return {route:"wmh-flair",title:"Гиперинтенсивности · оригинальный WMH fold 0",
      reason:null,needsExplicitFlair:true};
  return denied("Для этой модальности и анатомии пока нет подключённого прямого исполнителя. Это не означает отсутствие патологии.");
}
