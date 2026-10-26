import { strict as assert } from "node:assert";
import { combineVisionBatchEvidence } from "./vision-batch-evidence.ts";
import { validateEvidenceJson } from "./evidence-json.ts";
import type { VisionBatch } from "./vision-batch-ledger.ts";
const batches:VisionBatch[]=[{pass:"overview",indices:[0,1]},{pass:"overview",indices:[2]}];
const source=[0,1,2].map(i=>({index:i,seriesUid:"1.2.3",sopInstanceUid:"1.2.3."+i,frameIndex:0}));
const finding={findingId:"f1",sign:"research observation",anatomy:"lung",status:"candidate" as const,
  source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3.0",frameIndex:0,slicePositionMm:0},
  measurements:{diameterMm:null,volumeMl:null},
  model:{id:"vision",provider:"research" as const,version:null},limitations:["unverified"]};
const evidence={schema:"opus-evidence/v1" as const,modality:"CT" as const,coverage:"partially_assessed" as const,
  seriesReviewed:["1.2.3"],findings:[finding],warnings:["2D only"]};
const first={batchIndex:0,reviewedIndices:[0,1],evidence};
const result=combineVisionBatchEvidence(batches,source,[first],"CT");
assert.equal(result.findings.length,1);
assert.equal(result.findings[0].status,"requires_recheck");
assert.equal(result.coverage,"partially_assessed");
assert.equal(validateEvidenceJson(result),true);
assert.match(result.warnings.join(" "),/Overview incomplete/);
assert.throws(()=>combineVisionBatchEvidence(batches,source,[{...first,reviewedIndices:[0]}],"CT"));
assert.throws(()=>combineVisionBatchEvidence(batches,source,[{...first,evidence:{
  ...evidence,findings:[{...finding,source:{...finding.source,sopInstanceUid:"1.2.3.2"}}]}}],"CT"));
assert.throws(()=>combineVisionBatchEvidence(batches,source,[{...first,batchIndex:1}],"CT"));
assert.equal(combineVisionBatchEvidence(batches,source,[],"CT").coverage,"not_assessed");
console.log("PASS source-bound batch evidence, incomplete coverage and foreign-frame refusal");
