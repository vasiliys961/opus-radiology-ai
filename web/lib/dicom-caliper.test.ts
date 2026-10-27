import test from "node:test";
import assert from "node:assert/strict";
import {measureDicomInPlaneCaliper} from "./dicom-lite.ts";
import type {TechnicalDicomMetadata} from "./dicom-series.ts";

const make=(modality:"CT"|"MR",space:[number,number]):TechnicalDicomMetadata=>({
 modality,rows:64,columns:128,pixelSpacing:space,
 sopInstanceUid:"1.2.3",studyUid:"1.2",seriesUid:"1.2.3.4",
 frameOfReferenceUid:"1.2.3.5",instanceNumber:1,numberOfFrames:1,
 imagePositionPatient:[0,0,0],imageOrientationPatient:[1,0,0,0,1,0],
 transferSyntax:"1.2.840.10008.1.2.1",
});
test("actual CT source in-plane caliper respects PixelSpacing column/row order",()=>{
 const h=make("CT",[.7,1.4]);
 const result=measureDicomInPlaneCaliper(h,{x:10,y:20},{x:13,y:24});
 assert.equal(result.lengthMm,5.05);
 assert.deepEqual(result.deltaPixels,{x:3,y:4});
 assert.deepEqual(result.spacingMm,[.7,1.4]);
});
test("MRI supports same geometry and a different anisotropic spacing",()=>{
 const h=make("MR",[.5,1]);
 const horizontal=measureDicomInPlaneCaliper(h,{x:1,y:1},{x:11,y:1});
 assert.equal(horizontal.lengthMm,10);
 const vertical=measureDicomInPlaneCaliper(h,{x:1,y:1},{x:1,y:11});
 assert.equal(vertical.lengthMm,5);
 assert.equal(horizontal.start.x,1);
});
test("invalid original geometry or points fail closed without invented distances",()=>{
 for(const h of [
  make("CT",[0,1]),make("MR",[1,NaN]),make("MR",[10,1]),
  {...make("CT",[1,1]),rows:null},
  {...make("CT",[1,1]),modality:"US"},
 ]){
  assert.throws(()=>measureDicomInPlaneCaliper(
   h as TechnicalDicomMetadata,{x:1,y:1},{x:3,y:4}));
 }
 const h=make("MR",[1,1]);
 for(const [a,b] of [
  [{x:-1,y:4},{x:1,y:2}],
  [{x:1,y:1},{x:999,y:2}],
  [{x:NaN,y:1},{x:2,y:2}],
  [{x:1,y:1},{x:1,y:1}],
 ]){
  assert.throws(()=>measureDicomInPlaneCaliper(h,a,b));
 }
});
