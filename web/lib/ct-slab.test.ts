import test from "node:test";
import assert from "node:assert/strict";
import {groupDicomSeries,type DicomSeries,type TechnicalDicomMetadata} from "./dicom-series.ts";
import {maxCtSlabFrames,selectCtSlab} from "./ct-slab.ts";
import {checkMprEligibility} from "./mpr-eligibility.ts";
import {sourceIdentity,prepareAnalysisPackage} from "./analysis-package.ts";
import {prepareAnalysisStream} from "./analysis-stream.ts";

function series(n=103,rows=512,columns=512):DicomSeries {
  const base:TechnicalDicomMetadata={studyUid:"2.25.1",seriesUid:"2.25.2",frameOfReferenceUid:"2.25.3",sopInstanceUid:null,
    modality:"CT",rows,columns,numberOfFrames:1,instanceNumber:1,imageOrientationPatient:[1,0,0,0,1,0],
    imagePositionPatient:[10,20,-80],pixelSpacing:[0.7,0.7],transferSyntax:"1.2.840.10008.1.2.1"};
  return groupDicomSeries(Array.from({length:n},(_,i)=>({id:String(i),name:"synthetic.dcm",
    metadata:{...base,sopInstanceUid:`2.25.4.${i}`,instanceNumber:i+1,imagePositionPatient:[10,20,-80+i*3]}})))[0];
}
test("Large native CT remains blocked as full MPR but consecutive 32-frame slab is bounded without copying pixels",()=>{
  const original=series(),sizes=Array(103).fill(512*512*2+1000);
  assert.equal(checkMprEligibility(original,sizes).eligible,false);assert.equal(maxCtSlabFrames(original),32);
  const slab=selectCtSlab(original,sizes,20,51);
  assert.equal(checkMprEligibility(slab,sizes.slice(20,52)).eligible,true);
  assert.equal(slab.members.length,32);assert.equal(slab.members[0],original.members[20]);
  assert.equal(slab.members[31],original.members[51]);assert.equal(original.members.length,103);
  assert.deepEqual(slab.selection,{startIndex:20,endIndex:51,sourceFrameCount:103});
  assert.deepEqual(slab.members[0].metadata.imagePositionPatient,[10,20,-20]);
  assert.equal(slab.sliceSpacingMm,3);assert.notEqual(slab.key,original.key);
  assert.equal(maxCtSlabFrames(series(103,1024,1024)),8);
});
test("Slab refuses invalid ranges, geometry, modality, nested selection and file resources",()=>{
  const original=series(),sizes=Array(103).fill(1000);
  for(const [start,end] of [[-1,30],[0,32],[2,3],[2,103],[0.5,20],[5,4],[NaN,20]])
    assert.throws(()=>selectCtSlab(original,sizes,start,end),/Выберите/);
  assert.throws(()=>selectCtSlab({...original,modality:"MR"},sizes,0,31),/только для КТ/);
  assert.throws(()=>selectCtSlab({...original,volumeReady:false},sizes,0,31),/геометрией/);
  assert.throws(()=>selectCtSlab(original,sizes.slice(1),0,31),/неполный/);
  assert.throws(()=>selectCtSlab(original,Array(103).fill(20*1024*1024),0,31),/256 МиБ/);
  assert.throws(()=>selectCtSlab(original,sizes.map((s,i)=>i===2?0:s),0,31),/размеры/);
  assert.equal(maxCtSlabFrames(series(3)),0);
  const slab=selectCtSlab(original,sizes,0,31);assert.equal(maxCtSlabFrames(slab),0);
  const corrupted=series();corrupted.members[70].metadata.imagePositionPatient=[10,21,130];
  assert.throws(()=>selectCtSlab(corrupted,sizes,0,31),/изменились/); // cannot hide a bad source slice outside range
  const unordered=series();unordered.members.reverse();assert.throws(()=>selectCtSlab(unordered,sizes,0,31),/порядок/);
});
test("Different native slabs bind different SOP sets; export/stream retain exact shifted LPS and unchanged worker contract",async()=>{
  const original=series(12,3,2),sizes=Array(12).fill(1000);
  const a=selectCtSlab(original,sizes,2,5),b=selectCtSlab(original,sizes,6,9);
  const id="11111111-1111-4111-8111-111111111111";
  assert.notEqual(await sourceIdentity(a,id),await sourceIdentity(b,id));
  const geometry={dimensions:[2,3,4] as [number,number,number],affineLps:[0.7,0,0,10,0,0.7,0,20,0,0,3,-74] as [number,number,number,number,number,number,number,number,number,number,number,number]};
  const packet=await prepareAnalysisPackage(a,geometry,i=>-1000+i/4);
  const stream=await prepareAnalysisStream(a,geometry,i=>-1000+i/4,new AbortController().signal);
  assert.equal(packet.request.frameCount,4);assert.equal(packet.request.coverage,"not-confirmed");
  assert.equal(packet.request.scope,"selected-series-only");assert.deepEqual(packet.request.geometry,geometry);
  assert.equal(packet.request.inputSha256,stream.request.inputSha256);
  assert.equal(Object.hasOwn(stream.request,"selection"),false); // Python v1 request stays strict
  assert.equal(new DataView(packet.buffer).getFloat32(324,true),-74);
  await assert.rejects(prepareAnalysisPackage(a,{...geometry,dimensions:[2,3,12]},()=>0),/все кадры/);
});
