import {strict as assert} from "node:assert";
import {dispatchDicomDetectors} from "./dicom-detector-dispatch.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
import type {EvidenceJson} from "./evidence-json.ts";
const metadata={modality:"CT",bodyRegion:"CHEST",imageRole:"PRIMARY",
  seriesUid:"1.2.3",sopInstanceUid:"1.2.3.4"} as TechnicalDicomMetadata;
const series:DicomSeries={key:"s",label:"CT",modality:"CT",members:[{id:"a",name:"a",metadata}],
  spatiallySorted:true,volumeReady:true,sliceSpacingMm:1,warning:null};
const evidence:EvidenceJson={schema:"opus-evidence/v1",modality:"CT",coverage:"partially_assessed",
  seriesReviewed:["1.2.3"],warnings:["experimental"],findings:[{
    findingId:"nodule",sign:"candidate opacity",anatomy:"lung",status:"requires_recheck",
    source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3.4",frameIndex:0,slicePositionMm:0},
    measurements:{diameterMm:null,volumeMl:null},
    model:{id:"test-model",provider:"local",version:"test"},limitations:[],
  }]};
let calls=0;
const valid={target:"pulmonary-nodules",modality:"CT" as const,
 eligible:()=>true,run:async()=>{calls++;return evidence;}};
const result=await dispatchDicomDetectors(series,[valid]);
assert.equal(calls,1);
assert.deepEqual(result.executed,["pulmonary-nodules"]);
assert.equal(result.evidence[0].findings[0].source.sopInstanceUid,"1.2.3.4");
assert.ok(result.blocked.some(x=>x.reason==="No registered executable model"));
const denied=await dispatchDicomDetectors(series,[{...valid,
 run:async()=>({...evidence,findings:[{...evidence.findings[0],
  source:{...evidence.findings[0].source,sopInstanceUid:"foreign"}}]})}]);
assert.equal(denied.executed.length,0);
assert.equal(denied.evidence.length,0);
assert.ok(denied.blocked.some(x=>x.target==="pulmonary-nodules"));
const empty=await dispatchDicomDetectors(series,[]);
assert.equal(empty.executed.length,0);
assert.equal(empty.evidence.length,0);
const missing=await dispatchDicomDetectors({...series,members:[{...series.members[0],
 metadata:{...metadata,sopInstanceUid:null}}]},[valid]);
assert.equal(missing.executed.length,0);
const rejectedHuman=await dispatchDicomDetectors(series,[{...valid,run:async()=>({
 ...evidence,findings:[{...evidence.findings[0],status:"verified_by_human" as const}],
})}]);
assert.equal(rejectedHuman.executed.length,0);
const rejectedFullCoverage=await dispatchDicomDetectors(series,[{...valid,run:async()=>({
 ...evidence,coverage:"assessed" as const,
})}]);
assert.equal(rejectedFullCoverage.executed.length,0);
const rejectedProvider=await dispatchDicomDetectors(series,[{...valid,run:async()=>({
 ...evidence,findings:[{...evidence.findings[0],model:{
  ...evidence.findings[0].model,provider:"research" as const}}],
})}]);
assert.equal(rejectedProvider.executed.length,0);
assert.equal(result.evidence[0].findings[0].status,"requires_recheck");
console.log("PASS registered detector execution, status and DICOM evidence gates");
