/**
 * Source-only DICOM CT pixel calibration gate for future CPU densitometry.
 * It proves numeric rescale *metadata*, not that Cornerstone has applied it
 * (once versus twice), nor noncontrast/full-inspiration/kernel adequacy.
 */
import type {DicomSeries} from "./dicom-series.ts";

export type CtHuCalibration={
  status:"metadata-ready"|"blocked";
  slope:number|null;
  intercept:number|null;
  units:"HU"|"OTHER"|"UNSPECIFIED";
  frameCount:number;
  reason:string;
  /** Even metadata-ready does NOT authorize LAA-950 without decoded voxel QC. */
  decodedHuVerified:false;
  quantitativeLaa950Permitted:false;
};

export function assessCtHuCalibration(series:DicomSeries|null|undefined):CtHuCalibration {
  const blocked=(reason:string):CtHuCalibration=>({
    status:"blocked",slope:null,intercept:null,units:"UNSPECIFIED",
    frameCount:series?.members.length??0,reason,
    decodedHuVerified:false,quantitativeLaa950Permitted:false,
  });
  if(!series||series.modality!=="CT"||series.members.length<3||
     !series.volumeReady||!series.spatiallySorted)
    return blocked("Нужна геометрически подтверждённая КТ-серия без пропусков.");
  const m=series.members.map(x=>x.metadata);
  const first=m[0];
  const slope=first.rescaleSlope,intercept=first.rescaleIntercept;
  if(typeof slope!=="number"||!Number.isFinite(slope)||slope<=0||slope>1024||
     typeof intercept!=="number"||!Number.isFinite(intercept)||Math.abs(intercept)>65536)
    return blocked("DICOM Rescale Slope/Intercept отсутствуют или недопустимы.");
  if(m.some(x=>x.modality!=="CT"||x.rescaleUnit==="OTHER"))
    return blocked("Другая модальность или тип шкалы пикселей, не HU.");
  if(m.some(x=>x.rescaleUnit!=="HU"))
    return blocked("Для количественной HU-денситометрии нужен Rescale Type = HU на каждом срезе.");
  if(m.some(x=>typeof x.rescaleSlope!=="number"||
      typeof x.rescaleIntercept!=="number"||
      !Number.isFinite(x.rescaleSlope)||!Number.isFinite(x.rescaleIntercept)||
      Math.abs(x.rescaleSlope-slope)>1e-6||
      Math.abs(x.rescaleIntercept-intercept)>1e-3))
    return blocked("Неодинаковые Rescale Slope/Intercept по серии.");
  if(m.some(x=>(x.numberOfFrames??1)!==1))
    return blocked("Мультифреймовое CT-перемасштабирование не поддерживается.");
  return {status:"metadata-ready",slope,intercept,units:"HU",
    frameCount:m.length,
    reason:"DICOM HU-метаданные согласованы; фактическая калибровка декодированных вокселей и протокол КТ ещё не проверены.",
    decodedHuVerified:false,quantitativeLaa950Permitted:false};
}
