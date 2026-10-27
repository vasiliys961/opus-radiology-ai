import {strict as assert} from "node:assert";
import {dispatchDicomDetectors} from "./dicom-detector-dispatch.ts";
import {installedDetectorRegistry,OFFICIAL_SAMIHS_CHECKPOINT_SHA256} from "./installed-detector-registry.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
const base={modality:"CT",bodyRegion:"HEAD",imageRole:"PRIMARY",numberOfFrames:1,
 seriesUid:"1.2.3"} as TechnicalDicomMetadata;
const series:DicomSeries={key:"head",label:"CT head",modality:"CT",spatiallySorted:true,volumeReady:true,
 warning:null,sliceSpacingMm:1,members:[0,1,2].map(i=>({
 id:"id"+i,name:"slice",metadata:{...base,sopInstanceUid:"1.2.3."+(i+4)}
}))};
const none=installedDetectorRegistry({});
assert.equal(none.executors.length,0);
assert.equal(none.unavailable[0].target,"intracerebral-hemorrhage");
let calls=0;
const runtime={
 ready:true, modelId:"samihs-ich-binary-ct" as const,
 checkpointSha256:OFFICIAL_SAMIHS_CHECKPOINT_SHA256,
 dataPolicy:"public-reference-only" as const,
 run:async()=>{calls++;return {
 schema:"opus-local-ich-native-slices/v1" as const,
 modelId:"samihs-ich-binary-ct",modelVersion:"research",
 inputSha256:"a".repeat(64),verifiedSourceInputSha256:"a".repeat(64),
 orderedSopInstanceUids:["1.2.3.4","1.2.3.5","1.2.3.6"],
 candidates:[{sourceFrameIndex:1,sign:"candidate hemorrhagic region",anatomy:"head"}],
 }},
};
assert.equal(installedDetectorRegistry({ichRuntime:runtime}).executors.length,0);
assert.equal(installedDetectorRegistry({ichRuntime:{...runtime,ready:false},publicResearchAuthorized:true}).executors.length,0);
assert.equal(installedDetectorRegistry({ichRuntime:{...runtime,checkpointSha256:"b".repeat(64)},publicResearchAuthorized:true}).executors.length,0);
const registered=installedDetectorRegistry({ichRuntime:runtime,publicResearchAuthorized:true});
assert.equal(registered.executors.length,1);
const result=await dispatchDicomDetectors(series,registered.executors);
assert.deepEqual(result.executed,["intracerebral-hemorrhage"]);
assert.equal(result.evidence[0].findings[0].source.sopInstanceUid,"1.2.3.5");
assert.equal(calls,1);
const spoof={...runtime,run:async()=>({...await runtime.run(),modelId:"other"})};
const denied=await dispatchDicomDetectors(series,installedDetectorRegistry({
 ichRuntime:spoof,publicResearchAuthorized:true,
}).executors);
assert.equal(denied.executed.length,0);
assert.equal(denied.evidence.length,0);
assert.equal(calls,2);
console.log("PASS local registry requires research admission, pinned checkpoint, trusted live worker and native DICOM binding");
