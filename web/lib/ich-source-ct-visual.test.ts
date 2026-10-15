import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readNiftiCtHeader,verifyNiftiCtSource,renderNativeCtPlane} from "./nifti-ct-review.ts";
import {readVerifiedIchNativeSlice,validateIchSourceNativeGeometry} from "./ich-source-ct-visual.ts";
import type {IchAlternativeReport,IchAlternativeCandidate} from "./ianpan-ich-report.ts";

const projection={
 boundingBoxNativeNiftiXYZ:[2,3,4,7,8,4] as [number,number,number,number,number,number],
 boundingBoxWorldRasMm:[2,3,8,7,8,8] as [number,number,number,number,number,number],
 projectionMethod:"vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1" as const,
 trimmedOutsideOriginalCT:false,
 independentlyClinicallyVerified:false as const,
 expertMaskCompared:false as const,
};
const c=(type:"intraparenchymal"|"any"):IchAlternativeCandidate=>({
 sliceIndexModelOrdered:4,class:type,rawUncalibratedScore:.97,
 heatmapPositivePixelsAtPoint5:31,
 modelInputBoundingBoxXY:[2,3,7,8],
 localizationFrame:"preprocessed_512_model_input_not_source_voxel",
 clinicallyConfirmed:false,sourceVoxelProjection:{...projection}
});
function publicReport(){
 return {
  schema:"opus-ianpan-genuine-public-ich-research/v1",
  readyForClinicalUse:false,modelInputHeatmapsAreSourceAligned:false,
  source:{sourceDimensionsXYZ:[16,16,8],modelOrderedSliceCount:8,
    researchRoiClinicalValidation:false,researchRoiVoxelGeometryProjectionAvailable:true},
  candidates:[c("intraparenchymal"),c("any")]
 } as IchAlternativeReport;
}
function nativeHeader(){
 return {
  dimensions:[16,16,8] as [number,number,number],
  affineLps:[-1,0,0,0,0,-1,0,0,0,0,2,0] as
    [number,number,number,number,number,number,number,number,number,number,number,number],
  datatype:16 as const,bytesPerVoxel:4 as const,bytes:352+16*16*8*4
 };
}
test("project one real-model subtype ROI onto same exact original NIfTI geometry, never count any twice",()=>{
 const result=validateIchSourceNativeGeometry(publicReport(),nativeHeader());
 assert.equal(result.length,1);
 assert.equal(result[0].subtype,"intraparenchymal");
 assert.equal(result[0].modelSourceSliceIndex,4);
 assert.deepEqual(result[0].sourceVoxelBoundingBoxXYZ,[2,3,4,7,8,4]);
 assert.equal(result[0].clinicalHemorrhageConfirmed,false);
});
test("reject a deceptive NIfTI with identical dimensions but shifted source affine",()=>{
 const bad=nativeHeader();bad.affineLps=[-1,0,0,1,0,-1,0,0,0,0,2,0];
 assert.throws(()=>validateIchSourceNativeGeometry(publicReport(),bad),/Физическая ориентация/);
 const s=nativeHeader();s.dimensions=[17,16,8];
 assert.throws(()=>validateIchSourceNativeGeometry(publicReport(),s),/Не совпадает/);
});
function ctFixture(){
 const data=new Float32Array(16*16*8);
 for(let z=0;z<8;z++)for(let i=0;i<16*16;i++)data[z*256+i]=-1024+z*100+i;
 const header=new ArrayBuffer(352);
 const dv=new DataView(header);
 dv.setInt32(0,348,true);dv.setInt16(40,3,true);
 for(let i=0;i<3;i++)dv.setInt16(42+2*i,[16,16,8][i],true);
 for(let i=48;i<=54;i+=2)dv.setInt16(i,1,true);
 dv.setInt16(70,16,true);dv.setInt16(72,32,true);
 dv.setFloat32(108,352,true);dv.setUint8(123,2);
 dv.setInt16(254,1,true);dv.setInt16(252,0,true);
 const ras=[1,0,0,0,0,1,0,0,0,0,2,0];
 ras.forEach((n,i)=>dv.setFloat32(280+i*4,n,true));
 [110,43,49,0].forEach((n,i)=>dv.setUint8(344+i,n));
 const bytes=new Uint8Array(352+data.byteLength);
 bytes.set(new Uint8Array(header));
 bytes.set(new Uint8Array(data.buffer),352);
 return {file:new Blob([bytes]),sha:createHash("sha256").update(bytes).digest("hex")};
}
test("verify COMPLETE true NIfTI source by SHA then read only a single original 16×16 slice",async()=>{
 const {file,sha}=ctFixture();
 const source=await readNiftiCtHeader(file);
 await verifyNiftiCtSource(file,sha);
 const slice=await readVerifiedIchNativeSlice(file,source,sha,4);
 assert.equal(slice.pixels.length,256);
 assert.equal(slice.pixels[0],-624);
 assert.equal(slice.pixels[255],-369);
 assert.deepEqual(slice.sourceRange,[4,4]);
 assert.equal(slice.sourceSha256,sha);
 assert.equal(slice.affineLps[11],8);
 assert.equal(renderNativeCtPlane(slice,"k",0,64,64,0,400).length,64*64*4);
 await assert.rejects(()=>verifyNiftiCtSource(file,"f".repeat(64)),/SHA-256/);
 await assert.rejects(()=>readVerifiedIchNativeSlice(file,source,sha,8),/индексная/);
 const stop=new AbortController();stop.abort();
 await assert.rejects(()=>readVerifiedIchNativeSlice(file,source,sha,4,stop.signal),/отменено/);
});
