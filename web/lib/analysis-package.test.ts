import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertResultBinding, parseSegmentationResult, prepareAnalysisPackage, sha256, sourceIdentity, writeScalarNifti, type SegmentationResult } from "./analysis-package.ts";
import { parseNiftiMask, transformPoint, type MaskGeometry } from "./segmentation-mask.ts";
import type { DicomSeries, TechnicalDicomMetadata } from "./dicom-series.ts";

const geometry: MaskGeometry={dimensions:[3,2,3],affineLps:[0,-2,0,30,1,0,0,20,0,0,4,-10]};
const requestId="11111111-1111-4111-8111-111111111111";
function series(): DicomSeries {
  const base: TechnicalDicomMetadata={sopInstanceUid:null,studyUid:"2.25.10",seriesUid:"2.25.20",frameOfReferenceUid:"2.25.30",modality:"MR",instanceNumber:null,numberOfFrames:1,rows:2,columns:3,imagePositionPatient:null,imageOrientationPatient:null,pixelSpacing:[1,2],transferSyntax:"1.2.840.10008.1.2.1"};
  return {key:"test",label:"test",modality:"MR",spatiallySorted:true,volumeReady:true,sliceSpacingMm:4,warning:null,
    members:[1,2,3].map(i=>({id:String(i),name:`ignored-${i}`,metadata:{...base,sopInstanceUid:`2.25.4.${i}`}}))};
}
async function packet() {return prepareAnalysisPackage(series(),geometry,i=>i%3);}
async function resultFixture() {
  const p=await packet(), mask=parseNiftiMask(p.buffer);
  const r: SegmentationResult={schema:"opus-segmentation-result/v1",requestId:p.request.requestId,
    sourceIdentitySha256:p.request.sourceIdentitySha256,inputSha256:p.request.inputSha256,maskSha256:await sha256(p.buffer),
    model:{id:"synthetic-test",version:"1",weightsSha256:"a".repeat(64),modality:"MR",task:"fixture-only"},
    labels:[{id:1,name:"synthetic one"},{id:2,name:"synthetic two"}],limitations:["Synthetic fixture; no model inference."]};
  return {p,mask,r};
}
test("full scalar NIfTI preserves oblique LPS geometry, order and fractional/negative values",async()=>{
  const buffer=await writeScalarNifti(geometry,i=>-3.25+i/2),v=new DataView(buffer);
  assert.equal(buffer.byteLength,352+18*4);assert.equal(v.getInt16(70,true),16);assert.equal(v.getInt16(254,true),1);
  const ras=Array.from({length:12},(_,i)=>v.getFloat32(280+i*4,true));
  const lps=ras.map((n,i)=>i<8?-n:n);
  assert.deepEqual(transformPoint(lps,[2,1,2]),[28,22,-2]);
  assert.deepEqual(Array.from({length:18},(_,i)=>v.getFloat32(352+i*4,true)),Array.from({length:18},(_,i)=>-3.25+i/2));
  assert.equal(v.getFloat32(112,true),1);assert.equal(v.getFloat32(116,true),0);assert.equal(v.getUint8(123),2);
});
test("exported scalar labels round-trip through the mask reader without orientation changes",async()=>{
  const p=await packet(),mask=parseNiftiMask(p.buffer);
  assert.deepEqual(mask.affineLps.map(n=>n===0?0:n),geometry.affineLps);
  assert.deepEqual([...mask.data],Array.from({length:18},(_,i)=>i%3));
  assert.equal(mask.labels[0].volumeMl,0.048);
});
test("export validates limits before touching voxels and rejects nonfinite scalars",async()=>{
  await assert.rejects(writeScalarNifti({...geometry,dimensions:[512,512,33]},()=>{throw Error("must not read");}),/8 388/);
  await assert.rejects(writeScalarNifti({...geometry,dimensions:[0,2,3]},()=>0),/Экспорт/);
  for (const value of [NaN,Infinity,1e100]) await assert.rejects(writeScalarNifti(geometry,()=>value),/скалярные/);
});
test("export cancellation releases work before another scalar chunk is read",async()=>{
  const c=new AbortController();c.abort();
  await assert.rejects(writeScalarNifti(geometry,()=>{throw Error("must not read");},{signal:c.signal}),{name:"AbortError"});
  const next=new AbortController();let reads=0;
  await assert.rejects(writeScalarNifti({...geometry,dimensions:[100,100,4]},()=>{reads++;return 1;},{signal:next.signal,yieldControl:async()=>{next.abort();}}),{name:"AbortError"});
  assert.equal(reads,32768);
});
test("header precision loss that moves corners beyond physical tolerance is rejected",async()=>{
  await assert.rejects(writeScalarNifti({...geometry,affineLps:[1,0,0,1e10+1,0,1,0,0,0,0,1,0]},()=>0),/Положение/);
});
test("source identity binds UID set, study and request salt, independent of filenames/order",async()=>{
  const s=series(),original=await sourceIdentity(s,requestId);
  s.members.reverse();s.members[0].name="renamed";
  assert.equal(await sourceIdentity(s,requestId),original);
  assert.notEqual(await sourceIdentity(s,"22222222-2222-4222-8222-222222222222"),original);
  for(const member of s.members)member.metadata.studyUid="2.25.99";
  assert.notEqual(await sourceIdentity(s,requestId),original);
});
test("missing/contradictory/duplicate source UIDs fail closed",async()=>{
  for(const change of [
    (s:DicomSeries)=>{s.members[0].metadata.frameOfReferenceUid=null;},
    (s:DicomSeries)=>{s.members[1].metadata.studyUid="2.25.99";},
    (s:DicomSeries)=>{s.members[1].metadata.sopInstanceUid=s.members[0].metadata.sopInstanceUid;},
    (s:DicomSeries)=>{s.members[1].metadata.numberOfFrames=2;},
    (s:DicomSeries)=>{s.volumeReady=false;},
  ]) {const s=series();change(s);await assert.rejects(sourceIdentity(s,requestId));}
});
test("package covers every selected frame and does not serialize raw UIDs or filenames",async()=>{
  const p=await packet(),json=JSON.stringify(p.request);
  assert.equal(p.request.inputSha256,await sha256(p.buffer));assert.equal(p.request.frameCount,3);
  assert.equal(p.request.sequence,"not-confirmed");assert.equal(p.request.scope,"selected-series-only");
  assert.equal(json.includes("2.25."),false);assert.equal(json.includes("ignored"),false);
  await assert.rejects(prepareAnalysisPackage(series(),{...geometry,dimensions:[3,2,4]},()=>0),/все кадры/);
});
test("a result binds request, complete source input and exact mask bytes",async()=>{
  const {p,mask,r}=await resultFixture();
  const parsed=parseSegmentationResult(JSON.stringify({...r,ignoredPatientName:"must be dropped"}));
  assert.deepEqual(parsed,r);assertResultBinding(parsed,p.request,mask,r.maskSha256);
  for (const key of ["requestId","sourceIdentitySha256","inputSha256"] as const) {
    assert.throws(()=>assertResultBinding({...r,[key]:"different"},p.request,mask,r.maskSha256),/другому пакету/);
  }
  assert.throws(()=>assertResultBinding(r,p.request,mask,"f".repeat(64)),/сумма маски/);
});
test("binding rejects wrong modality, missing label dictionary entries and shifted geometry",async()=>{
  const {p,mask,r}=await resultFixture();
  assert.throws(()=>assertResultBinding({...r,model:{...r.model,modality:"CT"}},p.request,mask,r.maskSha256),/Модальность/);
  assert.throws(()=>assertResultBinding({...r,labels:[]},p.request,mask,r.maskSha256),/словаре/);
  assert.throws(()=>assertResultBinding(r,p.request,{...mask,affineLps:[0,-2,0,31,1,0,0,20,0,0,4,-10]},r.maskSha256),/Положение/);
});
test("result parser rejects future schemas, oversized content, invalid hashes, IDs and text",async()=>{
  const {r}=await resultFixture();
  for(const change of [
    {...r,schema:"opus-segmentation-result/v2"}, {...r,inputSha256:"a"}, {...r,requestId:"not-a-uuid"},
    {...r,labels:[{id:1,name:"one"},{id:1,name:"two"}]}, {...r,labels:[{id:0,name:"background"}]},
    {...r,labels:[{id:true,name:"bool"}]}, {...r,labels:[{id:1,name:"\u0000bad"}]},
    {...r,model:{...r.model,task:""}}, {...r,limitations:Array(21).fill("too many")},
  ]) assert.throws(()=>parseSegmentationResult(JSON.stringify(change)));
  assert.throws(()=>parseSegmentationResult(" ".repeat(65537)),/64 КиБ/);
});
test("Python packaging CLI consumes actual input/weight/mask bytes, and refuses changed input and overwrite",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"opus-result-"));
  try {
    const {p,r}=await resultFixture();
    await writeFile(join(dir,"request.json"),JSON.stringify(p.request));await writeFile(join(dir,"input.nii"),new Uint8Array(p.buffer));
    await writeFile(join(dir,"mask.nii"),new Uint8Array(p.buffer));await writeFile(join(dir,"weights.test"),"SYNTHETIC ARTIFACT - NOT MODEL WEIGHTS");
    await writeFile(join(dir,"labels.json"),JSON.stringify(r.labels));
    const args=[new URL("../../scripts/package-segmentation-result.py",import.meta.url).pathname,
      "--request",join(dir,"request.json"),"--input",join(dir,"input.nii"),"--mask",join(dir,"mask.nii"),
      "--weights-artifact",join(dir,"weights.test"),"--model-id","synthetic-test","--model-version","1","--task","fixture-only",
      "--labels",join(dir,"labels.json"),"--output",join(dir,"result.json"),"--limitation",r.limitations[0]];
    const run=()=>spawnSync("python3",args,{encoding:"utf8"});
    const done=run();assert.equal(done.status,0,done.stderr);
    const result=parseSegmentationResult(await readFile(join(dir,"result.json"),"utf8"));
    assert.equal(result.model.weightsSha256,await sha256(new TextEncoder().encode("SYNTHETIC ARTIFACT - NOT MODEL WEIGHTS").buffer));
    assertResultBinding(result,p.request,parseNiftiMask(p.buffer),r.maskSha256);
    assert.notEqual(run().status,0);await rm(join(dir,"result.json"));
    await writeFile(join(dir,"input.nii"),"altered input");assert.match(run().stderr,/do not match/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
