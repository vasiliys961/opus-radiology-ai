import test from "node:test";
import assert from "node:assert/strict";
import {assessAutomaticBrainFlair} from "./automatic-brain-flair.ts";
import {suggestPrimaryDicomSeries} from "./automatic-primary-series.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";

function mr(tr:number|null,te:number|null,ti:number|null):DicomSeries{
 return {key:"brain-flair",label:"public",modality:"MR",volumeReady:true,spatiallySorted:true,
 sliceSpacingMm:1,warning:null,
 members:Array.from({length:24},(_,i)=>({
   id:"mr-"+i,name:"slice-"+i+".dcm",metadata:{
     modality:"MR",bodyRegion:"HEAD",imageRole:"PRIMARY",
     studyUid:"1.2.3",seriesUid:"1.2.3.4",sopInstanceUid:"1.2.3.4."+String(i+1),
     frameOfReferenceUid:"1.2.3.5",numberOfFrames:1,
     imagePositionPatient:[0,0,i],imageOrientationPatient:[1,0,0,0,1,0],
     repetitionTimeMs:tr,echoTimeMs:te,inversionTimeMs:ti,
   } as TechnicalDicomMetadata,
 }))};
}
test("long-TI T2-FLAIR candidate is automatically eligible for research WMH",()=>{
 const a=assessAutomaticBrainFlair(mr(9000,120,2500));
 assert.equal(a.eligible,true);
 assert.deepEqual(a.parameters,{trMs:9000,teMs:120,tiMs:2500});
});
test("MPRAGE, STIR, T2, malformed and varying parameters never auto-label FLAIR",()=>{
 for(const seq of [[2300,3,900],[4500,80,160],[9000,100,null],[9000,100,160],
    [9000,35,2200],[20000,120,2500]] as const)
  assert.equal(assessAutomaticBrainFlair(mr(seq[0],seq[1],seq[2])).eligible,false,String(seq));
 let changed=mr(9000,120,2500);
 changed.members[4].metadata.inversionTimeMs=100;
 assert.equal(assessAutomaticBrainFlair(changed).eligible,false);
});
test("source UID, Frame of Reference and physical geometry must be established",()=>{
 const original=mr(9500,130,2300);
 const variants:DicomSeries[]=[
  {...original,volumeReady:false},
  {...original,spatiallySorted:false},
  {...original,members:original.members.map((m,i)=>i===2?
   {...m,metadata:{...m.metadata,studyUid:null}}:m)},
  {...original,members:original.members.map((m,i)=>i===2?
   {...m,metadata:{...m.metadata,frameOfReferenceUid:"7.8.9"}}:m)},
  {...original,members:original.members.map((m,i)=>i===2?
   {...m,metadata:{...m.metadata,imagePositionPatient:null}}:m)},
  {...original,members:original.members.map((m,i)=>i===2?
   {...m,metadata:{...m.metadata,imageRole:"DERIVED"}}:m)},
  {...original,members:original.members.map((m,i)=>i===2?
   {...m,metadata:{...m.metadata,bodyRegion:"SPINE"}}:m)},
 ];
 for(const [i,s] of variants.entries())assert.equal(
  assessAutomaticBrainFlair(s).eligible,false,"source variant "+i);
});
test("automatic primary selection prefers source-verified FLAIR over another brain MR sequence",()=>{
 const t1=mr(2300,3,900);
 t1.key="t1-mprage";
 t1.members=t1.members.map((m,i)=>({...m,id:"t1-"+i,metadata:{...m.metadata,
  seriesUid:"1.2.3.9",sopInstanceUid:"1.2.3.9."+String(i+1)}}));
 const flair=mr(9000,120,2500);
 const available=new Set([...t1.members,...flair.members].map(m=>m.id));
 assert.equal(suggestPrimaryDicomSeries([t1,flair],available).key,flair.key);
 assert.equal(suggestPrimaryDicomSeries([flair,t1],available).key,flair.key);
});
console.log("PASS conservative source-verified automatic brain FLAIR");
