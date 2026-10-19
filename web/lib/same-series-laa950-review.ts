/** Local-only binding of real CPU sampled CT density to SAME source R231
 * evidence and dual LLM review. Nothing in this module goes to provider.
 */
import {sameSeriesR231Facts,type CapturedLocalSpecialist} from "./same-series-r231-cloud-evidence.ts";
import type {DicomSeries} from "./dicom-series.ts";
import type {Laa950CpuResearch} from "./cpu-lung-laa950.ts";

export type CapturedLocalLaa950={
  seriesKey:string;
  sourceMemberIds:readonly string[];
  sourceInputSHA256:string;
  maskSHA256:string;
  measurement:Laa950CpuResearch;
};
export type LocalSameSeriesLaa950={
  schema:"opus-local-laa950-llm-context/v1";
  sourceScope:"same_CT_series_browser_only";
  neverSentToProvider:true;
  emphysemaDiagnosis:null;
  lowAttenuationPctOfSampledMask:number;
  sourceFrameCount:number;
  rightLungPct:number;leftLungPct:number;
  wholeLungCoverageConfirmed:false;
  voxelCalibrationIndependentlyVerified:false;
};
export function sameSeriesLaa950ForReview(
  series:DicomSeries|null|undefined,
  specialist:CapturedLocalSpecialist|null|undefined,
  captured:CapturedLocalLaa950|null|undefined,
):LocalSameSeriesLaa950|null{
  if(!captured||!series||!specialist||captured.seriesKey!==series.key||
     specialist.seriesKey!==series.key)return null;
  const facts=sameSeriesR231Facts(series,specialist);
  if(!facts) return null;
  if(captured.sourceMemberIds.length!==series.members.length||
     captured.sourceMemberIds.some((id,i)=>id!==series.members[i].id)||
     captured.sourceInputSHA256!==specialist.evidence.source.inputSha256||
     captured.maskSHA256!==specialist.evidence.mask.sha256)
    throw Error("laa950_not_bound_to_same_original_CT");
  const report=captured.measurement;
  if(report.schema!=="opus-local-r231-laa950-sampled-ct/v1"||
     report.modality!=="CT"||report.model!=="lungmask-R231"||
     report.sourceFrameCount!==facts.frameCount||
     report.originalHuMetadataConfirmed!==true||
     report.independentVoxelRescaleVerification!==false||
     report.wholeLungMeasurementProven!==false||
     report.emphysemaDiagnosis!==null||report.copdDiagnosis!==null||
     report.clinicallyValidated!==false||report.additionalProviderCalls!==false||
     report.originalDicomTransmitted!==false||
     !Array.isArray(report.lungs)||report.lungs.length!==2||
     report.lungs[0].label!==1||report.lungs[1].label!==2)
    throw Error("invalid_local_laa950_clinical_status");
  const acceptable=(n:number)=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=100;
  if(!acceptable(report.totalMaskLowAttenuationPct)||
     report.lungs.some(x=>!acceptable(x.lowAttenuationPctOfSampledMask))||
     Math.abs(report.lungs[0].maskVolumeMl-facts.rightLungMaskMl)>Math.max(.01,facts.rightLungMaskMl*.002)||
     Math.abs(report.lungs[1].maskVolumeMl-facts.leftLungMaskMl)>Math.max(.01,facts.leftLungMaskMl*.002))
    throw Error("laa950_R231_volume_or_percentage_mismatch");
  return {
    schema:"opus-local-laa950-llm-context/v1",
    sourceScope:"same_CT_series_browser_only",
    neverSentToProvider:true,emphysemaDiagnosis:null,
    lowAttenuationPctOfSampledMask:report.totalMaskLowAttenuationPct,
    sourceFrameCount:facts.frameCount,
    rightLungPct:report.lungs[0].lowAttenuationPctOfSampledMask,
    leftLungPct:report.lungs[1].lowAttenuationPctOfSampledMask,
    wholeLungCoverageConfirmed:false,voxelCalibrationIndependentlyVerified:false,
  };
}
