import {groupDicomSeries,type DicomSeries} from "./dicom-series.ts";
import {checkMprEligibility,MAX_MPR_FILES,MAX_MPR_RAW_BYTES} from "./mpr-eligibility.ts";
import {MAX_MASK_VOXELS} from "./segmentation-mask.ts";

/** Explicit consecutive native slices, never resampling or full-study acceptance. */
export const MAX_CT_SLAB_FRAMES=32;
export function maxCtSlabFrames(series:DicomSeries|null):number {
  if(!series||series.modality!=="CT"||!series.volumeReady||!series.spatiallySorted||series.selection)return 0;
  const {rows,columns}=series.members[0]?.metadata??{};
  if(!Number.isSafeInteger(rows)||!Number.isSafeInteger(columns)||!rows||!columns||rows<1||columns<1||rows>2048||columns>2048)return 0;
  const plane=rows*columns;
  const maximum=Math.min(MAX_CT_SLAB_FRAMES,MAX_MPR_FILES,series.members.length-1,
    Math.floor(MAX_MASK_VOXELS/plane),Math.floor(MAX_MPR_RAW_BYTES/(plane*2)));
  return maximum>=3?maximum:0;
}
export function selectCtSlab(series:DicomSeries,fileSizes:readonly number[],start:number,end:number):DicomSeries {
  const maximum=maxCtSlabFrames(series);
  if(!maximum)throw new Error("Фрагмент доступен только для КТ с подтверждённой геометрией всей серии.");
  const checked=groupDicomSeries(series.members);
  if(checked.length!==1||!checked[0].volumeReady||!checked[0].spatiallySorted||
    checked[0].members.some((m,i)=>m.id!==series.members[i].id))throw new Error("Геометрия или порядок исходной серии изменились.");
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>=series.members.length||
    end-start+1<3||end-start+1>maximum)throw new Error(`Выберите от 3 до ${maximum} последовательных срезов в пределах серии.`);
  if(fileSizes.length!==series.members.length)throw new Error("Исходный набор файлов неполный.");
  const selected:DicomSeries={...series,key:series.key+`\u0001slab:${start}:${end}`,
    label:`Фрагмент КТ · срезы ${start+1}–${end+1} из ${series.members.length}`,
    members:series.members.slice(start,end+1),
    selection:{startIndex:start,endIndex:end,sourceFrameCount:series.members.length}};
  const preflight=checkMprEligibility(selected,fileSizes.slice(start,end+1));
  if(!preflight.eligible)throw new Error(preflight.reason);
  return selected;
}
