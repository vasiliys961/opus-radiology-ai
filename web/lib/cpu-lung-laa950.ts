/**
 * Real bounded CPU LAA-950 densitometry from a NATIVE local R231 CT mask
 * and native Cornerstone decoded scalar intensities (no rescaling here).
 *
 * Do NOT use as COPD/emphysema diagnosis; selected CT slab may be incomplete.
 * DICOM HU metadata and plausibility are necessary, but do NOT establish
 * Cornerstone applied the transform exactly once or CT protocol suitability.
 */
import type {DicomSeries} from "./dicom-series.ts";
import type {LabelMask} from "./segmentation-mask.ts";
import type {SegmentationEvidence} from "./segmentation-evidence.ts";
import {assessCtHuCalibration} from "./ct-hu-calibration.ts";
import {localLungFacts} from "./local-lung-review.ts";
import {assertMaskMatchesSource} from "./segmentation-mask.ts";

export type Laa950CpuResearch={
  schema:"opus-local-r231-laa950-sampled-ct/v1";
  clinicalStatus:"unverified_research_draft";
  model:"lungmask-R231";
  modality:"CT";
  originalHuMetadataConfirmed:true;
  independentVoxelRescaleVerification:false;
  sourceVolumeCoverage:"selected-series-only_not-full-lung-proven";
  sourceFrameCount:number;
  sourceBinding:"local-live-voxel-mask-grid";
  thresholdHU:-950;
  lungs:Array<{
    label:1|2;anatomy:"right"|"left";
    maskVoxelCount:number;maskVolumeMl:number;
    lowAttenuationVoxelCount:number;lowAttenuationVolumeMl:number;
    lowAttenuationPctOfSampledMask:number;
    averageDecodedIntensity:number;
  }>;
  totalMaskLowAttenuationPct:number;
  clinicallyValidated:false;wholeLungMeasurementProven:false;
  emphysemaDiagnosis:null;copdDiagnosis:null;negativeScreenEstablished:false;
  additionalProviderCalls:false;originalDicomTransmitted:false;
  limitations:string[];
};
const MAX=8*1024*1024;
const zero=()=>({count:0,low:0,sum:0});
const r3=(x:number)=>Math.round(x*1000)/1000;
export async function measureSampledR231Laa950(
 source:DicomSeries,evidence:SegmentationEvidence,mask:LabelMask,
 decodedVoxelAt:(index:number)=>number,
 options:{operatorConfirmedNoncontrastInspiratoryCT:boolean;signal?:AbortSignal;
          yieldControl?:()=>Promise<void>},
):Promise<Laa950CpuResearch>{
 const check=()=>{if(options.signal?.aborted)throw new Error("laa950_cancelled");};
 check();
 if(options.operatorConfirmedNoncontrastInspiratoryCT!==true)
   throw Error("noncontrast_inspiratory_CT_protocol_must_be_attested");
 const hu=assessCtHuCalibration(source);
 if(hu.status!=="metadata-ready")throw Error("unverified_source_DICOM_HU_calibration");
 // Independent source/evidence checks. Never accept only an arbitrary mask.
 const facts=localLungFacts(evidence);
 if(facts.frameCount!==source.members.length||source.members.length!==mask.dimensions[2]||
    evidence.source.scope!=="selected-series-only"||evidence.source.coverage!=="not-confirmed"||
    !source.volumeReady||!source.spatiallySorted)
   throw Error("R231_not_exact_loaded_DICOM_source");
 const count=mask.dimensions.reduce((a,b)=>a*b,1);
 if(!Number.isSafeInteger(count)||count<1000||count>MAX||mask.data.length!==count||
    mask.dimensions[0]<16||mask.dimensions[1]<16)
   throw Error("unbounded_or_incomplete_R231_mask");
 assertMaskMatchesSource(mask,evidence.mask.geometry);
 assertMaskMatchesSource(mask,evidence.source.geometry);
 const expected=mask.labels.filter(x=>x.id!==0);
 if(expected.length!==2||expected.some(x=>x.id!==1&&x.id!==2))
   throw Error("unexpected_R231_mask_label");
 const byLabel=[zero(),zero(),zero()];
 const yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
 for(let base=0;base<count;base+=32768){
   check();
   for(let i=base;i<Math.min(base+32768,count);i++){
     const label=mask.data[i];
     if(label===0)continue;
     if(label!==1&&label!==2)throw Error("unapproved_lung_label");
     const value=decodedVoxelAt(i);
     if(typeof value!=="number"||!Number.isFinite(value)||value< -1600||value>4000)
       throw Error("invalid_or_nonHU_Cornerstone_decoded_CT_pixel");
     const bucket=byLabel[label];
     bucket.count++;bucket.sum+=value;
     if(value<=-950)bucket.low++;
   }
   await yieldControl();
 }
 check();
 const ml=mask.voxelVolumeMm3/1000;
 if(!Number.isFinite(ml)||ml<=0||ml>1)throw Error("invalid_physical_voxel_size");
 const lungs=([1,2] as const).map(label=>{
   const o=byLabel[label];
   const volume=o.count*ml;
   // Small slabs are admissible *only* as local-slab metrics, never whole lung.
   if(o.count<1000||volume<30)throw Error("lung_slab_not_sufficient_for_quantitative_research");
   const mean=o.sum/o.count;
   if(!Number.isFinite(mean)||mean< -1050||mean> -250)
     throw Error("decoded_CT_intensities_not_plausibly_in_HU");
   const original=evidence.observations.find(x=>x.labelId===label);
   if(!original||original.kind!=="segmentation-measurement"||
      Math.abs(original.voxels-o.count)>0||
      Math.abs(original.volumeMl-volume)>Math.max(.01,volume*.002))
     throw Error("live_R231_mask_does_not_match_original_source_evidence");
   return {
     label,anatomy:label===1?"right" as const:"left" as const,
     maskVoxelCount:o.count,maskVolumeMl:r3(volume),
     lowAttenuationVoxelCount:o.low,lowAttenuationVolumeMl:r3(o.low*ml),
     lowAttenuationPctOfSampledMask:r3(o.low*100/o.count),
     averageDecodedIntensity:r3(mean),
   };
 });
 const denominator=lungs.reduce((a,b)=>a+b.maskVoxelCount,0);
 const low=lungs.reduce((a,b)=>a+b.lowAttenuationVoxelCount,0);
 return {
   schema:"opus-local-r231-laa950-sampled-ct/v1",
   clinicalStatus:"unverified_research_draft",
   model:"lungmask-R231",modality:"CT",originalHuMetadataConfirmed:true,
   independentVoxelRescaleVerification:false,
   sourceVolumeCoverage:"selected-series-only_not-full-lung-proven",
   sourceFrameCount:source.members.length,
   sourceBinding:"local-live-voxel-mask-grid",thresholdHU:-950,
   lungs,totalMaskLowAttenuationPct:r3(100*low/denominator),
   clinicallyValidated:false,wholeLungMeasurementProven:false,
   emphysemaDiagnosis:null,copdDiagnosis:null,negativeScreenEstablished:false,
   additionalProviderCalls:false,originalDicomTransmitted:false,
   limitations:[
     "Денситометрия только по реально обработанному фрагменту CT/R231; полнота обоих лёгких не доказана.",
     "Метаданные HU и правдоподобность интенсивностей не доказывают применение RescaleSlope/Intercept точно один раз в Cornerstone.",
     "Параметры реконструкции, доза, вдох и отсутствие внутривенного контраста подтверждены только оператором; измерение чувствительно к протоколу.",
     "Маска R231 — анатомическая сегментация, а не детектор эмфиземы, ХОБЛ или другого заболевания.",
     "Нет независимой экспертной разметки, врачебной валидации и возможности отрицательного заключения.",
   ],
 };
}
