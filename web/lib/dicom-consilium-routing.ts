/** Conservative local routing from allowlisted DICOM technical codes only.
 * No pixel analysis, clinical assertion or cloud transfer.
 */
import type { DicomSeries } from "./dicom-series.ts";
import { assignImagingSpecialists } from "./imaging-specialist-consilium.ts";
import type { ImagingStudyProfile } from "./imaging-specialist-consilium.ts";

export type DicomConsiliumRoute =
  | {status:"ready";specialists:string[];detectorTargets:string[];reason:null}
  | {status:"blocked";specialists:[];detectorTargets:[];reason:string};
const regions:Record<string,ImagingStudyProfile["regions"][number]>={
  HEAD:"brain",CHEST:"chest",ABDOMEN:"abdomen",PELVIS:"pelvis",
  SPINE:"spine",EXTREMITY:"joints",
};
const blocked=(reason:string):DicomConsiliumRoute=>({
  status:"blocked",specialists:[],detectorTargets:[],reason,
});
export function routeDicomConsilium(series:DicomSeries|null):DicomConsiliumRoute {
  if (!series||!series.members.length) return blocked("Выберите проиндексированную DICOM-серию.");
  if (series.modality!=="CT"&&series.modality!=="MR")
    return blocked("Консилиум пока поддерживает только КТ и МРТ.");
  const members=series.members.map(x=>x.metadata);
  const regionsSeen=new Set(members.map(x=>x.bodyRegion));
  if (regionsSeen.size!==1) return blocked("Противоречивые анатомические коды; маршрут требует проверки.");
  const region=members[0].bodyRegion;
  if (!region||!Object.hasOwn(regions,region))
    return blocked("Анатомическая область не подтверждена техническими DICOM-тегами.");
  if (members.some(x=>x.imageRole==="LOCALIZER"||x.imageRole==="DERIVED"))
    return blocked("Серия включает локализаторы или производные изображения; требуется исходная серия.");
  if (members.some(x=>x.modality!==series.modality))
    return blocked("Смешанные модальности в одной серии.");
  const assignments=assignImagingSpecialists({
    modality:series.modality,
    regions:[regions[region]],
    contrast:members.every(x=>x.contrastAgentDeclared===true)?"yes":"unknown",
  });
  return {status:"ready",specialists:assignments.map(x=>x.specialty),
    detectorTargets:[...new Set([...assignments.flatMap(x=>x.compatibleDetectorTargets),
      ...(region==="CHEST"&&series.modality==="CT"?["lung-low-attenuation-quantification"]:[])])],reason:null};
}
