import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {verifyResearchCurrentDicom} from "./totalseg-dicom-binding.ts";
import type {AnatomyProof} from "./totalseg-abdomen-import.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";

const digest=(file:File)=>createHash("sha256").update(new Uint8Array(4)).digest("hex");
const files=()=>Array.from({length:4},(_,i)=>
  new File([new Uint8Array([i,2,3,4])],i+".dcm"));
const sha=(f:File,i:number)=>createHash("sha256").update(new Uint8Array([i,2,3,4])).digest("hex");
function fixture(){
  const selected=files();
  const proof:AnatomyProof={
    anatomy:"lung",sourceSha256:"b".repeat(64),maskSha256:"a".repeat(64),
    firstSlice:35,lastSlice:38,fullDimensions:[4,3,103],
    labelNames:{10:"Доля"},missingLabels:[],status:"not_validated",
  };
  const base:TechnicalDicomMetadata={
    sopInstanceUid:"1.2.3.0",studyUid:"1.2.3",seriesUid:"1.2.4",
    frameOfReferenceUid:"1.2.5",modality:"CT",instanceNumber:1,
    numberOfFrames:1,rows:3,columns:4,transferSyntax:"1.2.840.10008.1.2.1",
    imagePositionPatient:[0,0,0],imageOrientationPatient:[1,0,0,0,1,0],
    pixelSpacing:[1,1],
  };
  const series:DicomSeries={
    key:"test",label:"synthetic CT",members:selected.map((f,i)=>({
      id:String(i),name:f.name,metadata:{...base,sopInstanceUid:"1.2.3."+i},
    })),
    spatiallySorted:true,volumeReady:true,modality:"CT",warning:null,sliceSpacingMm:1,
    selection:{startIndex:35,endIndex:38,sourceFrameCount:103},
  };
  const passport={
    schema:"opus-totalseg-native-mpr-slab/v1",
    sourceFullCtSha256:proof.sourceSha256,
    slabMaskSha256:proof.maskSha256,
    firstOriginalSliceIndexZeroBased:35,
    lastOriginalSliceIndexZeroBased:38,
    sourceDicomSelectedFrameSha256:selected.map(sha),
  };
  return {selected,series,proof,passport};
}
test("exact opened DICOM file bytes and verified original slice offsets bind research mask",async()=>{
  const {selected,series,proof,passport}=fixture();
  const checked=await verifyResearchCurrentDicom(JSON.stringify(passport),proof,series,selected);
  assert.equal(checked.sourceVerified,true);
  assert.equal(checked.frameCount,4);
  assert.deepEqual([checked.firstOriginalSliceIndexZeroBased,checked.lastOriginalSliceIndexZeroBased],[35,38]);
  assert.equal("studyUid" in checked,false);
});
test("legacy research manifest without per-frame SHA fails closed despite matching grid",async()=>{
  const x=fixture();delete (x.passport as Partial<typeof x.passport>).sourceDicomSelectedFrameSha256;
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,x.selected),/Старый паспорт/);
});
test("DICOM swapped among matching geometry and UIDs always rejects",async()=>{
  const x=fixture();
  const swapped=[...x.selected];[swapped[0],swapped[1]]=[swapped[1],swapped[0]];
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,swapped),/SHA-256 текущей КТ/);
  const modified=[...x.selected];modified[3]=new File([new Uint8Array([8,2,3,4])],"3.dcm");
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,modified),/SHA-256 текущей КТ/);
});
test("wrong selected slab offset or entire unverified partial source fails closed",async()=>{
  const x=fixture();
  x.series.selection!.startIndex=0;
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,x.selected),/другой диапазон/);
  x.series.selection=undefined;
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,x.selected),/Не подтверждена привязка/);
});
test("study/frame mismatch, unsupported modality and oversize digest lists fail",async()=>{
  const x=fixture();
  x.series.members[1].metadata.studyUid="DIFFERENT";
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,x.selected),/UID/);
  x.series.members[1].metadata.studyUid="1.2.3";
  x.series.modality="MR";
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,x.selected),/Открытая CT-серия/);
  x.series.modality="CT";
  x.passport.sourceDicomSelectedFrameSha256.push("invalid");
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,x.selected),/Старый паспорт/);
});
test("cancellation stops before hash reads and never marks research source verified",async()=>{
  const x=fixture(),abort=new AbortController();abort.abort();
  await assert.rejects(()=>verifyResearchCurrentDicom(JSON.stringify(x.passport),x.proof,x.series,x.selected,abort.signal),/отменена/);
});
