import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readNoduleNiftiHeader,parseBoundNoduleReport,verifyNoduleSource,readNoduleAxial} from "./live-nodule-report.ts";
import {transformPoint,type Affine} from "./segmentation-mask.ts";
const H="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01";
const revision="7226a40a4c3713f7d5469559b7f2fc296fd54825";
const A:Affine=[0.8,0,0,-150,0,0.8,0,-120,0,0,2.5,-200];
function volume(){
 const h=new ArrayBuffer(352),v=new DataView(h);
 v.setInt32(0,348,true);v.setInt16(40,3,true);
 [8,8,8,1,1,1,1].forEach((n,i)=>v.setInt16(42+i*2,n,true));
 v.setInt16(70,4,true);v.setInt16(72,16,true);
 v.setFloat32(108,352,true);v.setUint8(123,2);v.setInt16(254,1,true);
 [0,1,2].forEach(row=>[0,1,2,3].forEach(col=>
   v.setFloat32(280+16*row+4*col,(row<2?-1:1)*A[row*4+col],true)));
 [110,43,49,0].forEach((n,i)=>v.setUint8(344+i,n));
 const pixels=new Int16Array(8*8*8);pixels.fill(-800);pixels[5*64+2*8+3]=-100;
 return new Blob([h,pixels]);
}
function evidence(sha:string){
 const c=transformPoint(A,[3,2,5]);
 return {
  schema:"opus-monai-bound-nodule-inference/v1",
  source:{format:"NIfTI-1-uncompressed",modality:"CT",anatomy:"CHEST",sha256:sha,
    dimensions:[8,8,8],affineLps:A,headerVerified:true,
    operatorVerifiedFullSelectedSeries:true,sourceDICOMIdentityIndependentlyVerified:false},
  model:{id:"monai-lung-nodule-ct-retinanet",version:"0.6.9",weightsSha256:H,
    bundleRevision:revision,pretrainedCheckpointReadFromVerifiedBundle:true},
  execution:{type:"isolated-linux-cpu-research",actualPretrainedInferenceCompleted:true,
    modelCalledOnThisExactSource:true,seconds:1000,peakProcessRssBytes:5e9,
    cpuPatch:[192,192,80],upstreamEvaluationPatchModified:true},
  candidates:[{index:0,score:0.91,centerLpsMm:c,extentModelMm:[6,6,6],
    nativeVoxelIndexHypothesis:[3,2,5],sourceCoordinateFrameIndependentlyVerified:false,
    clinicalFindingConfirmed:false}],
  clinicalStatus:"unverified_research_draft",
  sourceWorldCoordinateFrameIndependentlyVerified:false,clinicallyValidated:false,
  negativeDiagnosisAllowed:false,limitations:["not validated","source only","no FROC"]
 };
}
test("one native axial slice decoded, no 3D volume allocation",async()=>{
 const f=volume(),header=await readNoduleNiftiHeader(f);
 assert.deepEqual(header.dimensions,[8,8,8]);
 const plane=await readNoduleAxial(f,header,5);
 assert.equal(plane.length,64);assert.equal(plane[2*8+3],-100);
});
test("source-specific nodule report binds physical LPS and model checkpoint",async()=>{
 const f=volume(),sha=createHash("sha256").update(Buffer.from(await f.arrayBuffer())).digest("hex");
 const src=await readNoduleNiftiHeader(f);
 await verifyNoduleSource(f,sha);
 const parsed=parseBoundNoduleReport(JSON.stringify(evidence(sha)),src);
 assert.equal(parsed.candidates[0].nativeVoxelIndexHypothesis?.[2],5);
 assert.equal(parsed.clinicallyValidated,false);
});
test("refuse forged clinical status, model and transformed coordinates",async()=>{
 const src=await readNoduleNiftiHeader(volume());const base=evidence("f".repeat(64));
 for(const edit of [{clinicallyValidated:true},{negativeDiagnosisAllowed:true}]){
   assert.throws(()=>parseBoundNoduleReport(JSON.stringify({...base,...edit}),src));
 }
 assert.throws(()=>parseBoundNoduleReport(JSON.stringify({...base,model:{...base.model,weightsSha256:"0".repeat(64)}}),src));
 assert.throws(()=>parseBoundNoduleReport(JSON.stringify({...base,
   source:{...base.source,affineLps:[...A.slice(0,3),A[3]+2,...A.slice(4)]}}),src));
 assert.throws(()=>parseBoundNoduleReport(JSON.stringify({...base,
   candidates:[{...base.candidates[0],nativeVoxelIndexHypothesis:[1,1,1]}]}),src));
});
test("forged source SHA refused before original CT visualization",async()=>{
 const f=volume();await assert.rejects(()=>verifyNoduleSource(f,"e".repeat(64)),/SHA-256/);
});
