import test from "node:test";
import assert from "node:assert/strict";
import {sourceClickToMetaImagePoint} from "./metaimage-physician-point.ts";
const sha="a".repeat(64);
const geometry={
 dimensions:[512,512,109],spacingMm:[0.8,0.8,2.5],
 origin:[-120,-150,-200],
 directionMatrix:[[1,0,0],[0,-1,0],[0,0,-1]],
};
test("manual source-point index maps exactly through oblique-aware MetaImage world transformation",()=>{
 const x=sourceClickToMetaImagePoint(sha,geometry,[100,200,25]);
 assert.deepEqual(x.index3d,[100,200,25]);
 assert.deepEqual(x.metaImagePhysicalMm,[-40,-310,-262.5]);
 assert.equal(x.sourcePixelsSha256Verified,true);
 assert.equal(x.coordinateSystem,"metaimage_physical_not_verified_as_dicom_lps");
 assert.equal(x.modelCandidateMatchVerified,false);
 assert.equal(x.diagnosisConfirmed,false);
 assert.equal(x.seriesInstanceUid,null);
 assert.equal(x.sopInstanceUid,null);
});
test("unverified pixels, out-of-bounds indices and invalid geometry cannot be assigned a point",()=>{
 assert.throws(()=>sourceClickToMetaImagePoint("bad",geometry,[0,0,0]),/Непроверенные/);
 assert.throws(()=>sourceClickToMetaImagePoint(sha,geometry,[512,0,0]),/пределами/);
 assert.throws(()=>sourceClickToMetaImagePoint(sha,geometry,[-1,0,0]),/пределами/);
 assert.throws(()=>sourceClickToMetaImagePoint(sha,geometry,[1.5,0,0]),/индекс/);
 assert.throws(()=>sourceClickToMetaImagePoint(sha,{...geometry,spacingMm:[0,0.8,2.5]},[0,0,0]),/геометрия/);
});
test("direction matrix rotation affects physical point rather than assuming axial array is DICOM",()=>{
 const r=sourceClickToMetaImagePoint(sha,{
  dimensions:[10,10,10],spacingMm:[2,3,4],origin:[10,20,30],
  directionMatrix:[[0,1,0],[-1,0,0],[0,0,1]],
 },[2,3,4]);
 assert.deepEqual(r.metaImagePhysicalMm,[19,16,46]);
});
