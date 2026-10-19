import test from "node:test";
import assert from "node:assert/strict";
import {measureSampledR231Laa950} from "./cpu-lung-laa950.ts";
import {invertAffine,type LabelMask} from "./segmentation-mask.ts";
import type {DicomSeries} from "./dicom-series.ts";
import type {SegmentationEvidence} from "./segmentation-evidence.ts";

const N=32*32*32,HALF=N/2,voxelMl=.004;
const geom={dimensions:[32,32,32] as [number,number,number],
  affineLps:[1,0,0,0,0,1,0,0,0,0,4,0] as [number,number,number,number,number,number,number,number,number,number,number,number]};
const mask:LabelMask={
 ...geom,data:Uint16Array.from({length:N},(_,i)=>i<HALF?1:2),
 inverseLps:invertAffine(geom.affineLps),
 labels:[{id:1,voxels:HALF,volumeMl:HALF*voxelMl},
  {id:2,voxels:HALF,volumeMl:HALF*voxelMl}],
 voxelVolumeMm3:4,
};
const members=Array.from({length:32},(_,i)=>({id:"browser-"+i,name:"private-file-"+i,
  metadata:{modality:"CT",rescaleSlope:1,rescaleIntercept:-1024,rescaleUnit:"HU",numberOfFrames:1}}));
const series={key:"private-local-ct",modality:"CT",volumeReady:true,spatiallySorted:true,members} as unknown as DicomSeries;
const evidence={
 schema:"opus-specialist-evidence/v1",clinicalStatus:"unverified_research_draft",
 producer:{kind:"specialist-model",executionMode:"local",
  model:{id:"lungmask-R231",version:"0.2.20",
   weightsSha256:"d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f"}},
 source:{scope:"selected-series-only",coverage:"not-confirmed",modality:"CT",frameCount:32,
  inputSha256:"a".repeat(64),sourceIdentitySha256:"c".repeat(64),geometry:geom},
 mask:{sha256:"b".repeat(64),geometry:geom},
 observations:[{kind:"segmentation-measurement",labelId:1,volumeMl:HALF*voxelMl,voxels:HALF},
   {kind:"segmentation-measurement",labelId:2,volumeMl:HALF*voxelMl,voxels:HALF}],
} as unknown as SegmentationEvidence;
const decodedHU=(i:number)=>i<HALF?(i<1638?-980:-860):(i<HALF+3276?-970:-870);
const opts={operatorConfirmedNoncontrastInspiratoryCT:true,yieldControl:async()=>{}};

test("Native R231 mask and decoded CT voxels produce actual <= -950 HU counts on CPU",async()=>{
 const r=await measureSampledR231Laa950(series,evidence,mask,decodedHU,opts);
 assert.equal(r.lungs[0].lowAttenuationVoxelCount,1638);
 assert.equal(r.lungs[1].lowAttenuationVoxelCount,3276);
 assert.equal(r.lungs[0].maskVoxelCount,HALF);
 assert.equal(r.lungs[1].maskVoxelCount,HALF);
 assert.equal(r.lungs[0].maskVolumeMl,65.536);
 assert.equal(r.lungs[0].lowAttenuationPctOfSampledMask,9.998);
 assert.equal(r.lungs[1].lowAttenuationPctOfSampledMask,19.995);
 assert.equal(r.totalMaskLowAttenuationPct,14.996);
 assert.equal(r.sourceVolumeCoverage,"selected-series-only_not-full-lung-proven");
 assert.equal(r.independentVoxelRescaleVerification,false);
 assert.equal(r.wholeLungMeasurementProven,false);
 assert.equal(r.emphysemaDiagnosis,null);
 assert.equal(r.copdDiagnosis,null);
 assert.equal(r.additionalProviderCalls,false);
 assert.equal(r.originalDicomTransmitted,false);
 const serialized=JSON.stringify(r);
 assert.equal(serialized.includes("private-local-ct"),false);
 assert.equal(serialized.includes("a".repeat(64)),false);
});
test("Missing HU or different slice transforms block before scanning pixels",async()=>{
 let calls=0;
 const read=()=>{calls++;return -900;};
 for(const changed of [
   {...series,members:members.map((m,i)=>({...m,metadata:{...m.metadata,rescaleSlope:i===3?2:1}}))},
   {...series,members:members.map(m=>({...m,metadata:{...m.metadata,rescaleUnit:"OTHER"}}))},
   {...series,volumeReady:false},
 ])await assert.rejects(measureSampledR231Laa950(changed as DicomSeries,evidence,mask,read,opts),/unverified_source/);
 assert.equal(calls,0);
});
test("Raw unscaled intensities, wrong R231, cancelled work and unconfirmed CT refuse results",async()=>{
 await assert.rejects(measureSampledR231Laa950(series,evidence,mask,()=>250,opts),/not_plausibly/);
 await assert.rejects(measureSampledR231Laa950(series,evidence,mask,decodedHU,
   {...opts,operatorConfirmedNoncontrastInspiratoryCT:false}),/must_be_attested/);
 await assert.rejects(measureSampledR231Laa950(series,evidence,mask,decodedHU,
   {...opts,signal:AbortSignal.abort()}),/cancelled/);
 await assert.rejects(measureSampledR231Laa950(series,{...evidence,
   producer:{...evidence.producer,model:{...evidence.producer.model,id:"not-R231"}}},mask,decodedHU,opts));
});
test("Masked values are only measured at R231 labels, missing/extra label not tolerated",async()=>{
 const badMask={...mask,data:mask.data.slice()};
 badMask.data[10]=3;
 await assert.rejects(measureSampledR231Laa950(series,evidence,badMask,decodedHU,opts),/unapproved/);
 const changed={...evidence,observations:evidence.observations.map((o,i)=>({...o,voxels:i?o.voxels:o.voxels-1}))};
 await assert.rejects(measureSampledR231Laa950(series,changed,mask,decodedHU,opts),/does_not_match/);
});
