import {test} from "node:test";
import {strict as assert} from "node:assert";
import {verifyRenalThreePhaseStudy} from "./renal-three-phase-gate.ts";
import type {DicomSeries} from "./dicom-series.ts";

function sample(key:string,study="1.2.3",frame="1.2.4"):DicomSeries{
 const metadata={
  sopInstanceUid:"1.2.5."+key,studyUid:study,seriesUid:"1.2.6."+key,
  frameOfReferenceUid:frame,modality:"CT",instanceNumber:1,numberOfFrames:1,
  rows:64,columns:64,imagePositionPatient:[0,0,0] as [number,number,number],
  imageOrientationPatient:[1,0,0,0,1,0] as [number,number,number,number,number,number],
  pixelSpacing:[1,1] as [number,number],rescaleSlope:1,rescaleIntercept:-1024,
  rescaleUnit:"HU" as const,contrastAgentDeclared:true,bodyRegion:"ABDOMEN" as const,
  imageRole:"PRIMARY" as const,transferSyntax:"1.2.840.10008.1.2.1",
 };
 return {key,label:key,modality:"CT",spatiallySorted:true,volumeReady:true,
  sliceSpacingMm:1,warning:null,members:Array.from({length:8},(_,i)=>({
   id:key+"-"+i,name:"test",metadata:{...metadata,sopInstanceUid:"1.2.5."+key+i,instanceNumber:i+1},
  }))};
}
test("rejects three arbitrary abdominal series without proven phase roles",()=>{
 const a=["a","v","e"].map(k=>sample(k));
 assert.equal(verifyRenalThreePhaseStudy(a,new Set(a.flatMap(s=>s.members.map(m=>m.id)))).status,"not_assessed");
});
test("accepts separately assigned same-study source volumes only for registration",()=>{
 const a=["a","v","e"].map(k=>sample(k));const files=new Set(a.flatMap(s=>s.members.map(m=>m.id)));
 assert.equal(verifyRenalThreePhaseStudy(a,files,{artery:"a",vein:"v",excret:"e"}).status,"ready_for_registration");
 assert.equal(verifyRenalThreePhaseStudy(a,files,{artery:"a",vein:"a",excret:"e"}).status,"not_assessed");
 assert.equal(verifyRenalThreePhaseStudy(a,files,{artery:"a",vein:"v",excret:"missing"}).status,"not_assessed");
});
test("rejects cross-study, mismatched reference and missing HU",()=>{
 const a=[sample("a"),sample("v","different"),sample("e")];
 const files=new Set(a.flatMap(s=>s.members.map(m=>m.id)));
 const roles={artery:"a",vein:"v",excret:"e"};
 assert.equal(verifyRenalThreePhaseStudy(a,files,roles).status,"not_assessed");
 a[1]=sample("v","1.2.3","different");
 assert.equal(verifyRenalThreePhaseStudy(a,files,roles).status,"not_assessed");
 a[1]=sample("v");a[1].members[0].metadata.rescaleUnit="OTHER";
 assert.equal(verifyRenalThreePhaseStudy(a,files,roles).status,"not_assessed");
});
