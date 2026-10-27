/** Actual local CT densitometry research evidence from source-checked R231 mask.
 * This is NOT a pathology classifier or emphysema diagnosis.
 */
import type { DicomSeries } from "./dicom-series.ts";
import type { DetectorExecutor } from "./dicom-detector-dispatch.ts";
import type { EvidenceJson } from "./evidence-json.ts";
import { sameSeriesLaa950ForReview, type CapturedLocalLaa950 } from "./same-series-laa950-review.ts";
import type { CapturedLocalSpecialist } from "./same-series-r231-cloud-evidence.ts";

export const LAA950_TARGET="lung-low-attenuation-quantification";
export function localLaa950Executor(
  capturedR231: CapturedLocalSpecialist|null|undefined,
  capturedLaa950: CapturedLocalLaa950|null|undefined,
):DetectorExecutor {
  return {
    target:LAA950_TARGET,modality:"CT",
    eligible:(series:DicomSeries)=>{
      if(series.modality!=="CT"||!series.volumeReady||!series.spatiallySorted||
          series.members.some(m=>m.metadata.bodyRegion!=="CHEST"))return false;
      try{return !!sameSeriesLaa950ForReview(series,capturedR231,capturedLaa950);}
      catch{return false;}
    },
    run:async(series:DicomSeries):Promise<EvidenceJson>=>{
      const measurement=sameSeriesLaa950ForReview(series,capturedR231,capturedLaa950);
      if(!measurement)throw Error("No real source-bound local LAA950 measurement");
      const uid=series.members[0]?.metadata.seriesUid;
      if(!uid||series.members.some(m=>m.metadata.seriesUid!==uid))throw Error("Series UID mismatch");
      return {
        schema:"opus-evidence/v1",modality:"CT",coverage:"partially_assessed",
        seriesReviewed:[uid],
        findings:[],
        warnings:[
          "Local R231 lung-mask plus CT HU low-attenuation research measurement; not a pathology detector.",
          "Measured fraction below -950 HU within sampled R231 lung mask: "+
            measurement.lowAttenuationPctOfSampledMask.toFixed(2)+"%.",
          "Right: "+measurement.rightLungPct.toFixed(2)+"%; left: "+
            measurement.leftLungPct.toFixed(2)+"%.",
          "Full-lung coverage and independent voxel-rescale calibration NOT verified. No emphysema diagnosis.",
        ],
      };
    },
  };
}
