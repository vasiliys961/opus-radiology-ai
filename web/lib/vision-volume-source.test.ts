import test from "node:test";
import assert from "node:assert/strict";
import {planOriginalVolumeSource,prepareOriginalVolumeBatches} from "./vision-volume-source.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
import type {AutomaticPrivacyPreparation} from "./auto-privacy-preparation.ts";

function originalSeries(count:number):DicomSeries{
  const base="2.25.103431";
  const members=Array.from({length:count},(_,i)=>({
    id:"source-"+i,name:"source-"+i+".dcm",
    metadata:{
      studyUid:base,seriesUid:base+".2",frameOfReferenceUid:base+".3",
      sopInstanceUid:base+".4."+(i+1),modality:"CT",
      numberOfFrames:1,instanceNumber:i+1,rows:64,columns:64,
      imagePositionPatient:[0,0,i],imageOrientationPatient:[1,0,0,0,1,0],
      pixelSpacing:[1,1],transferSyntax:"1.2.840.10008.1.2.1",
    } as TechnicalDicomMetadata,
  }));
  return {key:base+".2",label:"original CT",modality:"CT",members,
    spatiallySorted:true,volumeReady:true,sliceSpacingMm:1,warning:null};
}
test("103 original source SOPs produce 26 actual four-frame preparation batches",()=>{
  const s=originalSeries(103);
  const p=planOriginalVolumeSource(s);
  assert.equal(p.budget.overviewCoversAllFrames,true);
  assert.equal(p.batches.length,26);
  assert.deepEqual(p.batches[0].indices,[0,1,2,3]);
  assert.deepEqual(p.batches[25].indices,[100,101,102]);
  assert.deepEqual(p.sourceFrames.map(x=>x.index),Array.from({length:103},(_,i)=>i));
  assert.equal(p.sourceFrames[102].sopInstanceUid,s.members[102].metadata.sopInstanceUid);
  assert.equal(p.transmissionPermitted,false);
});
test("Targeted neighboring originals follow the complete overview, still source-bound",()=>{
  const p=planOriginalVolumeSource(originalSeries(9),{flaggedIndices:[6]});
  assert.deepEqual(p.batches.map(x=>x.pass),["overview","overview","overview","targeted","targeted"]);
  assert.deepEqual(p.batches[3].indices,[4,5,6,7]);
  assert.deepEqual(p.batches[4].indices,[8]);
});
test("Actual lazy decoder and local OCR/redaction execute every frame, no network permission",async()=>{
  const s=originalSeries(5);
  const files=new Map(s.members.map(m=>[m.id,{size:65536} as File]));
  const calls:number[]=[];
  const sizes:number[]=[];
  const decode=async (_file:File,_options:{maxPixels?:number})=>{
    calls.push(1);
    return {url:"data:image/png;base64,"+"a".repeat(200),
      metadata:{} as Awaited<ReturnType<typeof import("./dicom-lite.ts").decodeDicomPreview>>["metadata"]};
  };
  const prepare=async (urls:readonly (string|undefined)[])=>{
    sizes.push(urls.length);
    const frames=urls.map((_,i)=>({frameId:"frame-"+(i+1),sha256:"hash-"+i}));
    return {frames,ocr:Object.fromEntries(frames.map(f=>[f.frameId,{sha256:f.sha256}])),
      journal:{},redacted:0,unresolved:0} as unknown as AutomaticPrivacyPreparation;
  };
  const got=[];
  for await(const batch of prepareOriginalVolumeBatches(s,files,{
    signal:new AbortController().signal,
    decode:decode as typeof import("./dicom-lite.ts").decodeDicomPreview,
    prepare:prepare as typeof import("./auto-privacy-preparation.ts").autoPrepareVisionPrivacy,
  }))got.push(batch);
  assert.deepEqual(sizes,[4,1]);
  assert.equal(calls.length,5);
  assert.deepEqual(got.map(x=>x.indices),[[0,1,2,3],[4]]);
  assert.equal(got[1].sources[0].sopInstanceUid,s.members[4].metadata.sopInstanceUid);
  assert.ok(got.every(x=>!x.transmissionPermitted&&!x.physicianReviewed));
});
test("Corrupt geometry and repeated source SOP cannot start a local full review",()=>{
  const s=originalSeries(8);
  s.members[5].metadata.sopInstanceUid=s.members[0].metadata.sopInstanceUid;
  assert.throws(()=>planOriginalVolumeSource(s),/not verified/i);
  const bad=originalSeries(8);
  bad.volumeReady=false;
  assert.throws(()=>planOriginalVolumeSource(bad),/not verified/i);
});
test("Missing source DICOM fails closed, never counts a skipped batch",async()=>{
  const s=originalSeries(5);
  const files=new Map(s.members.slice(0,4).map(m=>[m.id,{size:500} as File]));
  let prepared=0;
  const stream=prepareOriginalVolumeBatches(s,files,{
    signal:new AbortController().signal,
    decode:async()=>({url:"data:image/png;base64,"+"a".repeat(200),metadata:{} as never}),
    prepare:async urls=>{
      prepared++;
      const frames=urls.map((_,i)=>({frameId:"frame-"+(i+1),sha256:"sha"}));
      return {frames,ocr:Object.fromEntries(frames.map(f=>[f.frameId,{sha256:f.sha256}])),
        journal:{},redacted:0,unresolved:0} as unknown as AutomaticPrivacyPreparation;
    },
  });
  const first=await stream.next();
  assert.equal(first.done,false);
  await assert.rejects(()=>stream.next(),/Missing\/oversized original DICOM/);
  assert.equal(prepared,1);
});
test("An aborted preparation does not decode or transmit",async()=>{
  const ctrl=new AbortController();ctrl.abort();
  const stream=prepareOriginalVolumeBatches(originalSeries(3),new Map(),{signal:ctrl.signal});
  await assert.rejects(()=>stream.next(),/cancelled/);
});
