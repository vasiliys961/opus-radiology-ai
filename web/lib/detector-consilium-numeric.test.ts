import test from "node:test";
import assert from "node:assert/strict";
import {assembleSanitizedDetectorBundle,validateSanitizedDetectorBundle} from "./detector-consilium-evidence.ts";
import {parseGeminiNumericReview,runNumericGeminiOpusConsilium} from "./detector-gemini-opus-numeric.ts";
import type {BoundNoduleReport} from "./live-nodule-report.ts";
import type {MediastinalNodeReport} from "./mediastinal-raidionics-worker.ts";

const source="a".repeat(64);
const nodules={source:{sha256:source},candidates:[{index:0},{index:1}]} as BoundNoduleReport;
const base=assembleSanitizedDetectorBundle({region:"chest",modality:"CT",
 nativeSourceSha256:source,nodules});
test("One actual detector -> one fixed numeric task; unavailable are never normal findings",()=>{
 assert.equal(validateSanitizedDetectorBundle(base),true);
 assert.equal(base.facts.length,5);
 assert.deepEqual(base.facts[0],{task:"lung_nodules",status:"completed",
   candidateCount:2,candidateVolumeMl:null});
 for(const notDone of base.facts.slice(1)){
  assert.equal(notDone.status,"not_assessed");
  assert.equal(notDone.candidateCount,null);
 }
 assert.equal(JSON.stringify(base).includes(source),false);
 assert.equal(JSON.stringify(base).includes("sopInstanceUid"),false);
 assert.equal(validateSanitizedDetectorBundle({...base,sourceSha256:source}),false);
 assert.equal(validateSanitizedDetectorBundle({...base,
    facts:[...base.facts,base.facts[0]]}),false);
 assert.equal(validateSanitizedDetectorBundle({...base,
    facts:base.facts.map((v,i)=>i===1?
      {...v,status:"completed",candidateCount:0,candidateVolumeMl:null}:v)}),true);
 assert.equal(validateSanitizedDetectorBundle({...base,
    facts:base.facts.map((v,i)=>i===1?
      {...v,status:"not_assessed",candidateCount:0,candidateVolumeMl:null}:v)}),false);
});
test("Never mix findings of separate original CT volumes",()=>{
 const other={sourceNiftiSHA256:"b".repeat(64),candidates:[]} as MediastinalNodeReport;
 assert.throws(()=>assembleSanitizedDetectorBundle({region:"chest",modality:"CT",
   nativeSourceSha256:source,nodules,nodes:other}),/разных исходных/);
 assert.throws(()=>assembleSanitizedDetectorBundle({region:"abdomen",modality:"CT"}),
   /Ни одна модель/);
});
test("Gemini must review exactly genuine completed tasks without inventing IDs",()=>{
 const ok=JSON.stringify({schema:"opus-gemini-numeric-detector-review/v1",
   reviewedTasks:["lung_nodules"],priorityTasks:["lung_nodules"],
   uncertainties:["Only sampled numerical evidence"]});
 assert.equal(parseGeminiNumericReview(ok,base).priorityTasks[0],"lung_nodules");
 assert.throws(()=>parseGeminiNumericReview(
  ok.replace('"lung_nodules"]','"pulmonary_embolism"]'),base));
});
test("Real two sequential provider calls use only numeric task facts and never image bytes",async()=>{
 const calls:unknown[]=[];
 const result=await runNumericGeminiOpusConsilium({
   bundle:base,provider:"openrouter",geminiModel:"google/test-gemini",
   opusModel:"anthropic/test-opus",call:async request=>{
    calls.push(request);
    const str=JSON.stringify(request);
    assert.equal(str.includes(source),false);
    assert.equal(str.includes("image_url"),false);
    assert.equal(str.includes("base64"),false);
    assert.equal(str.includes("sopInstanceUid"),false);
    if(request.model==="google/test-gemini")return {
      choices:[{finish_reason:"stop",message:{content:JSON.stringify({
       schema:"opus-gemini-numeric-detector-review/v1",
       reviewedTasks:["lung_nodules"],priorityTasks:["lung_nodules"],
       uncertainties:["Numeric model candidates only"],
      })}}]};
    assert.equal(request.model,"anthropic/test-opus");
    return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
     summary:"Unverified unsigned research candidate summary",
     limitations:["No images reviewed","Physician checks original DICOM"],
    })}}]};
   },
 });
 assert.deepEqual((calls as {model:string}[]).map(x=>x.model),
  ["google/test-gemini","anthropic/test-opus"]);
 assert.equal(result.clinicalStatus,"unverified_research_draft");
 assert.equal(result.pixelReviewPerformed,false);
 assert.equal(result.sourceIdentifiersSubmitted,false);
});
