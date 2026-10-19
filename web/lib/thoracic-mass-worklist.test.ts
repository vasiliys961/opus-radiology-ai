import test from "node:test";
import assert from "node:assert/strict";
import {interpretThoracicMasses,requireNativeChestCt,
 type ThoracicFindingInput} from "./thoracic-mass-worklist.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
const chest:DicomSeries={
 key:"PRIVATE-LOCAL-CT-series",label:"LOCAL-PRIVATE-NAME",
 modality:"CT",volumeReady:true,spatiallySorted:true,sliceSpacingMm:1,
 warning:null,
 members:Array.from({length:15},(_,i)=>({
  id:"LOCAL-DICOM-FILE-"+i,
  name:"PRIVATE-PATIENT-ID-slice-"+i,
  metadata:{modality:"CT",bodyRegion:"CHEST",numberOfFrames:1,
   sopInstanceUid:"1.2.3.4."+i,studyUid:"1.2.3.4",
   seriesUid:"1.2.3",frameOfReferenceUid:"1.2.9",
   rows:512,columns:512,pixelSpacing:[.7,.7],
   instanceNumber:i,transferSyntax:"1.2.840.10008.1.2.1",
   imagePositionPatient:[0,0,i],imageOrientationPatient:[1,0,0,0,1,0],
  }as TechnicalDicomMetadata,
 })),
};
const base={
 kind:"mediastinal_lymph_node",compartment:"middle_mediastinum",
 side:"right",sliceOrdinal:7,localSourceMemberId:chest.members[6].id,
 readerConfirmed:true,origin:"physician_annotation",contrast:"contrast",
 longestAxialMm:16,shortAxisMm:10,attenuation:"soft_tissue",
}as const satisfies ThoracicFindingInput;
test("Real selected source frame is bound without exporting private DICOM UID/name",()=>{
 const x=interpretThoracicMasses(chest,[base]);
 assert.equal(x.findings.length,1);
 assert.equal(x.findings[0].kind,"mediastinal_lymph_node");
 assert.equal(x.findings[0].sourceSliceOrdinal,7);
 assert.equal(x.findings[0].shortAxisMm,10);
 assert.equal(x.findings[0].observedByAutomaticDetector,false);
 assert.equal(x.findings[0].metastasisEstablished,false);
 assert.equal(x.findings[0].sourcePositionLpsMm,null);
 assert.equal(x.noMassesOrMetastasesEstablished,false);
 assert.equal(x.externalTransmission,false);
 const exported=JSON.stringify(x);
 for(const secret of ["PRIVATE-","LOCAL-DICOM-FILE-","1.2.3.4.","PRIVATE-PATIENT-ID"]){
  assert.equal(exported.includes(secret),false,secret);
 }
});
test("Distinct pulmonary nodule and >30 mm mass cannot be conflated",()=>{
 const n={...base,kind:"pulmonary_nodule",compartment:"lung",
  longestAxialMm:16,shortAxisMm:null}as const;
 const m={...n,kind:"pulmonary_mass",longestAxialMm:31}as const;
 assert.equal(interpretThoracicMasses(chest,[n,m]).findings.length,2);
 assert.throws(()=>interpretThoracicMasses(chest,[{...n,longestAxialMm:31}]));
 assert.throws(()=>interpretThoracicMasses(chest,[{...m,longestAxialMm:30}]));
});
test("Single swapped or stale frame, wrong compartment, invalid measurements fail closed",()=>{
 const bad:ThoracicFindingInput[]=[
  {...base,localSourceMemberId:chest.members[7].id},
  {...base,sliceOrdinal:0},
  {...base,sliceOrdinal:16},
  {...base,compartment:"lung"},
  {...base,shortAxisMm:20},
  {...base,longestAxialMm:Number.NaN},
  {...base,origin:"model_proven" as never},
  {...base,readerConfirmed:false as never},
  {...base,contrast:"MRA" as never},
 ];
 for(const entry of bad)assert.throws(()=>interpretThoracicMasses(chest,[entry]));
 assert.throws(()=>interpretThoracicMasses(chest,new Array(41).fill(base)));
});
test("Other modality, other body region, duplicate original IDs and no CT all blocked",()=>{
 assert.throws(()=>interpretThoracicMasses({...chest,modality:"MR"},[base]));
 assert.throws(()=>interpretThoracicMasses({...chest,members:
   chest.members.map(m=>({...m,metadata:{...m.metadata,bodyRegion:"ABDOMEN"}}))},[base]));
 assert.throws(()=>requireNativeChestCt({...chest,members:chest.members.map(m=>
   ({...m,id:"DUPLICATE"}))}));
 assert.throws(()=>interpretThoracicMasses({...chest,members:[]},[base]));
});
test("Incomplete node short axis is flagged, contrast requirements stated without cancer diagnosis",()=>{
 const output=interpretThoracicMasses(chest,[
  {...base,shortAxisMm:null,contrast:"unknown"},
  {...base,kind:"mediastinal_mass",compartment:"anterior_mediastinum",
   longestAxialMm:80,shortAxisMm:50},
 ]);
 assert.match(output.findings[0].caveats.join(" "),/Короткая ось/);
 assert.match(output.findings[0].caveats.join(" "),/контраст/);
 assert.equal(output.findings[1].findingOfCancerEstablished,false);
 assert.equal(output.completeThoraxReviewed,false);
 const empty=interpretThoracicMasses(chest,[]);
 assert.equal(empty.findings.length,0);
 assert.equal(empty.noMassesOrMetastasesEstablished,false);
});
