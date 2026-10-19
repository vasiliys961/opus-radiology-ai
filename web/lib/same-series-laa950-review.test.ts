import test from "node:test";
import assert from "node:assert/strict";
import {sameSeriesLaa950ForReview,type CapturedLocalLaa950} from "./same-series-laa950-review.ts";
import type {CapturedLocalSpecialist} from "./same-series-r231-cloud-evidence.ts";
import type {DicomSeries} from "./dicom-series.ts";
import type {SegmentationEvidence} from "./segmentation-evidence.ts";
import type {Laa950CpuResearch} from "./cpu-lung-laa950.ts";
const hashes={input:"a".repeat(64),mask:"b".repeat(64),study:"c".repeat(64)};
const members=Array.from({length:32},(_,i)=>({id:"PRIVATE-FILE-"+i,metadata:{modality:"CT"}}));
const series={key:"private-series",modality:"CT",volumeReady:true,spatiallySorted:true,members} as DicomSeries;
const geom={dimensions:[32,32,32],affineLps:[1,0,0,0,0,1,0,0,0,0,4,0]};
const evidence={
 schema:"opus-specialist-evidence/v1",clinicalStatus:"unverified_research_draft",
 producer:{kind:"specialist-model",executionMode:"local",model:{
  id:"lungmask-R231",version:"0.2.20",
  weightsSha256:"d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f"}},
 source:{sourceIdentitySha256:hashes.study,inputSha256:hashes.input,scope:"selected-series-only",
  coverage:"not-confirmed",modality:"CT",frameCount:32,geometry:geom},
 mask:{sha256:hashes.mask,geometry:geom},
 observations:[{kind:"segmentation-measurement",labelId:1,volumeMl:1200},
  {kind:"segmentation-measurement",labelId:2,volumeMl:1100}],
} as SegmentationEvidence;
const specialist:CapturedLocalSpecialist={
 seriesKey:series.key,sourceMemberIds:members.map(m=>m.id),evidence,
};
const report={
 schema:"opus-local-r231-laa950-sampled-ct/v1",modality:"CT",
 model:"lungmask-R231",sourceFrameCount:32,
 originalHuMetadataConfirmed:true,independentVoxelRescaleVerification:false,
 wholeLungMeasurementProven:false,emphysemaDiagnosis:null,copdDiagnosis:null,
 clinicallyValidated:false,additionalProviderCalls:false,originalDicomTransmitted:false,
 totalMaskLowAttenuationPct:10.65,
 lungs:[{label:1,maskVolumeMl:1200,lowAttenuationPctOfSampledMask:9.5},
   {label:2,maskVolumeMl:1100,lowAttenuationPctOfSampledMask:11.9}],
} as Laa950CpuResearch;
const captured:CapturedLocalLaa950={
 seriesKey:series.key,sourceMemberIds:members.map(m=>m.id),
 sourceInputSHA256:hashes.input,maskSHA256:hashes.mask,measurement:report,
};
test("Exact same local original CT binds R231+LAA metrics, with NO provider data",()=>{
 const x=sameSeriesLaa950ForReview(series,specialist,captured);
 assert.equal(x?.lowAttenuationPctOfSampledMask,10.65);
 assert.equal(x?.rightLungPct,9.5);
 assert.equal(x?.leftLungPct,11.9);
 assert.equal(x?.wholeLungCoverageConfirmed,false);
 assert.equal(x?.neverSentToProvider,true);
 assert.equal(x?.emphysemaDiagnosis,null);
 for(const secret of ["PRIVATE-FILE-","private-series",hashes.input,hashes.mask,hashes.study]){
   assert.equal(JSON.stringify(x).includes(secret),false);
 }
});
test("Old mask, changed CT source, reordered slices and invented model status fail closed",()=>{
 assert.equal(sameSeriesLaa950ForReview(series,specialist,null),null);
 assert.equal(sameSeriesLaa950ForReview({...series,key:"new CT"} as DicomSeries,specialist,captured),null);
 const fail=[
  {...captured,sourceInputSHA256:"d".repeat(64)},
  {...captured,maskSHA256:"d".repeat(64)},
  {...captured,sourceMemberIds:[members[1].id,members[0].id,...members.slice(2).map(m=>m.id)]},
  {...captured,measurement:{...report,independentVoxelRescaleVerification:true}},
  {...captured,measurement:{...report,wholeLungMeasurementProven:true}},
  {...captured,measurement:{...report,emphysemaDiagnosis:"emphysema"}},
  {...captured,measurement:{...report,originalDicomTransmitted:true}},
  {...captured,measurement:{...report,totalMaskLowAttenuationPct:NaN}},
  {...captured,measurement:{...report,lungs:[{...report.lungs[0],maskVolumeMl:900},report.lungs[1]]}},
 ];
 for(const item of fail)assert.throws(
  ()=>sameSeriesLaa950ForReview(series,specialist,item as CapturedLocalLaa950));
});
