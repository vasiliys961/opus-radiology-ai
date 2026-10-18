import test from "node:test";
import assert from "node:assert/strict";
import {localLungFacts,parseLocalLungFacts,parseLocalLungReview} from "./local-lung-review.ts";
const SHA="d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f";
const evidence={
 schema:"opus-specialist-evidence/v1",clinicalStatus:"unverified_research_draft",
 producer:{kind:"specialist-model",executionMode:"local",model:{
 id:"lungmask-R231",version:"0.2.20",weightsSha256:SHA}},
 source:{modality:"CT",frameCount:32,inputSha256:"a".repeat(64)},
 mask:{sha256:"b".repeat(64)},
 observations:[{kind:"segmentation-measurement",labelId:1,volumeMl:100.1},
  {kind:"segmentation-measurement",labelId:2,volumeMl:120.3}]
};
test("Source-bound R231 exports only numeric anatomy without identifiers",()=>{
 const result=localLungFacts(evidence as never);
 assert.deepEqual(Object.keys(result).sort(),[
   "coverage","frameCount","leftLungMaskMl","masksAreNotPathologyDetectors",
   "model","rightLungMaskMl","schema"].sort());
 assert.equal(result.coverage,"not-clinically-verified");
 assert.equal(JSON.stringify(result).includes("a".repeat(64)),false);
 assert.equal(parseLocalLungFacts(result).frameCount,32);
});
test("Reject patient text, UID and extra request fields",()=>{
 const p=localLungFacts(evidence as never);
 assert.throws(()=>parseLocalLungFacts({...p,patientName:"Someone"}),/invalid_local_lung_input/);
 assert.throws(()=>parseLocalLungFacts({...p,coverage:"full-normal-CT"}),/invalid_local_lung_input/);
});
test("Reject incomplete lung masks or wrong model",()=>{
 assert.throws(()=>localLungFacts({...evidence,observations:evidence.observations.slice(0,1)} as never));
 assert.throws(()=>localLungFacts({...evidence,producer:{...evidence.producer,model:{id:"different",version:"0.2.20",weightsSha256:SHA}}} as never));
});
test("Local text-only LLM must return bounded research JSON",()=>{
 const correct=JSON.stringify({schema:"opus-local-lung-llm-review/v1",
 summary:"This is a research mask and not a medical diagnosis.",
 qualityQuestions:["Confirm slice coverage"],limitations:["No pathology detection"]});
 assert.equal(parseLocalLungReview(correct).limitations.length,1);
 assert.throws(()=>parseLocalLungReview(correct.replace("opus-local-lung-llm-review/v1","diagnosis")));
});
