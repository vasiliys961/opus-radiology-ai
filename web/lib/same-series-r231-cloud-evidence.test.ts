import test from "node:test";
import assert from "node:assert/strict";
import {sameSeriesR231Facts,type CapturedLocalSpecialist} from "./same-series-r231-cloud-evidence.ts";
import type {DicomSeries} from "./dicom-series.ts";
import type {SegmentationEvidence} from "./segmentation-evidence.ts";

const modelSha="d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f";
const members=Array.from({length:32},(_,i)=>({id:"local-"+i}));
const grid={dimensions:[64,64,32],affineLps:[1,0,0,0,0,1,0,0,0,0,2,0]};
const series={key:"local-private-series",modality:"CT",members,spatiallySorted:true,volumeReady:true} as unknown as DicomSeries;
const evidence={
 schema:"opus-specialist-evidence/v1",clinicalStatus:"unverified_research_draft",
 producer:{kind:"specialist-model",executionMode:"local",model:{
  id:"lungmask-R231",version:"0.2.20",weightsSha256:modelSha}},
 source:{requestId:"local-only",sourceIdentitySha256:"c".repeat(64),inputSha256:"a".repeat(64),
  modality:"CT",scope:"selected-series-only",coverage:"not-confirmed",frameCount:32,geometry:grid},
 mask:{sha256:"b".repeat(64),geometry:grid},
 observations:[{kind:"segmentation-measurement",labelId:1,volumeMl:1200.1},
  {kind:"segmentation-measurement",labelId:2,volumeMl:1100.3}],
} as unknown as SegmentationEvidence;
const capture:CapturedLocalSpecialist={seriesKey:series.key,sourceMemberIds:members.map(m=>m.id),evidence};
test("Same physically loaded CT with authentic local R231 measurements exports safe numeric facts",()=>{
 const f=sameSeriesR231Facts(series,capture);
 assert.equal(f?.rightLungMaskMl,1200.1);assert.equal(f?.leftLungMaskMl,1100.3);
 assert.equal(f?.frameCount,32);assert.equal(f?.masksAreNotPathologyDetectors,true);
 const serialized=JSON.stringify(f);
 for(const forbidden of ["local-private-series","local-0","a".repeat(64),"b".repeat(64),"c".repeat(64)])
  assert.ok(!serialized.includes(forbidden));
});
test("Other series, unloaded detector or other modality never reuses old findings",()=>{
 assert.equal(sameSeriesR231Facts(series,null),null);
 assert.equal(sameSeriesR231Facts({...series,key:"another"} as DicomSeries,capture),null);
 assert.throws(()=>sameSeriesR231Facts({...series,modality:"MR"} as DicomSeries,capture),/not_bound/);
});
test("Same key but different DICOM member order, missing frame or altered source grid fail closed",()=>{
 for(const changed of [
  {...series,members:[members[1],members[0],...members.slice(2)]},
  {...series,members:members.slice(0,-1)},
  {...series,spatiallySorted:false},
  {...series,volumeReady:false},
 ])assert.throws(()=>sameSeriesR231Facts(changed as DicomSeries,capture),/not_bound/);
 for(const changed of [
  {...evidence,source:{...evidence.source,inputSha256:"0".repeat(63)}},
  {...evidence,source:{...evidence.source,frameCount:31}},
  {...evidence,mask:{...evidence.mask,geometry:{...grid,affineLps:[1,0,0,0,0,1,0,0,0,0,2,3]}}},
  {...evidence,producer:{...evidence.producer,executionMode:"gpu-server"}},
  {...evidence,observations:[evidence.observations[0]]},
 ])assert.throws(()=>sameSeriesR231Facts(series,{...capture,evidence:changed as SegmentationEvidence}));
});
