import {strict as assert} from "node:assert";
import {createLocalIchExecutor} from "./local-ich-detector-executor.ts";
import {dispatchDicomDetectors} from "./dicom-detector-dispatch.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
const head={modality:"CT",bodyRegion:"HEAD",imageRole:"PRIMARY",seriesUid:"1.2.3",numberOfFrames:1} as TechnicalDicomMetadata;
const series:DicomSeries={key:"h",label:"head",modality:"CT",volumeReady:true,spatiallySorted:true,
 sliceSpacingMm:1,warning:null,members:[0,1,2].map(i=>({
  id:"id"+i,name:"native",metadata:{...head,sopInstanceUid:"1.2.3."+(i+4)},
 }))};
const hash="a".repeat(64);
let called=0;
const executor=createLocalIchExecutor(async()=>{called++;return {
 schema:"opus-local-ich-native-slices/v1",modelId:"trained-ich-research",
 modelVersion:"research",inputSha256:hash,verifiedSourceInputSha256:hash,
 orderedSopInstanceUids:["1.2.3.4","1.2.3.5","1.2.3.6"],
 candidates:[{sourceFrameIndex:2,sign:"candidate high attenuation",anatomy:"brain"}],
};});
const result=await dispatchDicomDetectors(series,[executor]);
assert.deepEqual(result.executed,["intracerebral-hemorrhage"]);
assert.equal(called,1);
assert.equal(result.evidence[0].findings[0].source.sopInstanceUid,"1.2.3.6");
const unready={...series,volumeReady:false};
const denied=await dispatchDicomDetectors(unready,[executor]);
assert.equal(denied.executed.length,0);
assert.equal(called,1);
const forged=createLocalIchExecutor(async()=>({
 schema:"opus-local-ich-native-slices/v1" as const,modelId:"trained-ich-research",modelVersion:"research",
 inputSha256:hash,verifiedSourceInputSha256:"b".repeat(64),
 orderedSopInstanceUids:["1.2.3.4","1.2.3.5","1.2.3.6"],
 candidates:[{sourceFrameIndex:2,sign:"candidate",anatomy:"brain"}],
}));
const invalid=await dispatchDicomDetectors(series,[forged]);
assert.equal(invalid.executed.length,0);
console.log("PASS ICH registered dispatch, native SOP evidence, missing geometry and SHA rejection");
