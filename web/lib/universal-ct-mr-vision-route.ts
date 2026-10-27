/** Universal CT/MRI Vision route is independent of specialist detector availability.
 * This is readiness only. It neither grants cloud permission nor claims inference.
 */
import type {DicomSeries} from "./dicom-series.ts";
export type UniversalVisionRoute={
  modality:"CT"|"MR"|null;
  status:"eligible_for_authorization"|"blocked";
  reason:string;
  requiresReviewedImages:true;
  hasExecutedInference:false;
};
export function routeUniversalCtMrVision(series:DicomSeries|null):UniversalVisionRoute{
  const base={requiresReviewedImages:true as const,hasExecutedInference:false as const};
  if(!series||!series.members.length)return {...base,modality:null,status:"blocked",reason:"Выберите DICOM-серию."};
  if(series.modality!=="CT"&&series.modality!=="MR")
    return {...base,modality:null,status:"blocked",reason:"Универсальный Vision поддерживает КТ и МРТ."};
  const modality=series.modality;
  if(series.members.some(m=>m.metadata.modality!==modality))
    return {...base,modality,status:"blocked",reason:"Смешанные модальности: сначала разделите серию."};
  if(series.members.some(m=>m.metadata.imageRole==="LOCALIZER"))
    return {...base,modality,status:"blocked",reason:"Локализаторы не подходят для универсального анализа."};
  if(series.members.some(m=>!m.metadata.seriesUid||!m.metadata.sopInstanceUid))
    return {...base,modality,status:"blocked",reason:"Не подтверждён исходный DICOM UID каждого среза."};
  return {...base,modality,status:"eligible_for_authorization",
    reason:"КТ/МРТ подходит для подготовки кадров; запуск Gemini/Opus только после обезличивания и разрешения."};
}
