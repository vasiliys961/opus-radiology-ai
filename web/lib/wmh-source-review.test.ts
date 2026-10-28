import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {bindWmhToSelectedDicom} from "./wmh-source-review.ts";
import type {DicomSeries} from "./dicom-series.ts";
Object.defineProperty(globalThis,"crypto",{value:webcrypto,configurable:true});
const source=new Uint8Array([1,2,3,4]);
const sha=Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256",source)),v=>v.toString(16).padStart(2,"0")).join("");
const series={modality:"MR",volumeReady:true,spatiallySorted:true,members:[{
 id:"a",metadata:{bodyRegion:"HEAD",sopInstanceUid:"1.2.3",columns:8,rows:8}
}]} as DicomSeries;
const report={conversion:{modelInferenceCompleted:false,nativeGeometryPreserved:true,
 sourceFLAIRSHA256:"a".repeat(64),dimensions:[8,8,1],
 sourceSOPInstanceUIDs:["1.2.3"],sourceDicomSHA256:[sha]},
 inference:{schema:"opus-original-wmh-source-MRI-CPU-research/v1",
 realTrainedOriginalWMHModelForwardCompleted:true,sourceFLAIRSHA256:"a".repeat(64),
 checkpointSHA256:"b".repeat(64),candidateComponentCount:1,totalPredictedHyperintensityMl:.1,
 candidateComponents:[{component:1,voxels:5,volumeMl:.1,
 sourceVoxelBoundsInclusive:[[1,1,0],[2,2,0]],centroidNiftiRasMm:[1,2,3]}]}};
test("source-bound WMH component appears only for exact original DICOM bytes",async()=>{
 const good=await bindWmhToSelectedDicom(report,series,new Map([["a",new Blob([source])]]));
 assert.equal(good.components[0].volumeMl,.1);
 await assert.rejects(bindWmhToSelectedDicom(report,series,new Map([["a",new Blob([new Uint8Array([1,2,3,5])])]])),/SHA-256/);
});
test("reject out-of-range WMH evidence coordinates",async()=>{
 const bad=structuredClone(report);
 bad.inference.candidateComponents[0].sourceVoxelBoundsInclusive[1][2]=8;
 await assert.rejects(bindWmhToSelectedDicom(bad,series,new Map([["a",new Blob([source])]])),/локализация/);
});
