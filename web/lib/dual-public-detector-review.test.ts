import test from "node:test";
import assert from "node:assert/strict";
import {reviewPublicDetectorsWithTwoLlms,reconcileDualReviews,GEMINI_MODEL,OPUS_MODEL} from "./dual-public-detector-review.ts";
import type {PublicResearchCase,PublicLLMReview} from "./public-case-evidence.ts";
import type {AiGatewayRequest} from "./ai-gateway.ts";

const study:PublicResearchCase={
 schema:"opus-public-model-review/v1",caseId:"head-hemorrhage",
 title:"Pinned public CT",anatomy:"brain CT",modelNames:["Original genuine pretrained source models"],
 sourceUrl:"https://github.com/example/research",facts:[
  {id:"real-prediction",label:"Model score",detail:"Pretrained research model score 0.81; not calibrated."},
  {id:"reference-missing",label:"Expert mask",detail:"Independent radiologist mask not available."}
 ],limitations:["Clinical validation unavailable."],
 patientStudyAnalyzed:false,clinicalValidation:false,liveInference:false,
};
const reply=(id:string,priority:"high"|"medium"|"low")=>({
 choices:[{finish_reason:"stop",message:{content:JSON.stringify({
 schema:"opus-public-llm-review/v1",
 rankedFacts:[{factId:id,priority,reason:"Needs source image and expert verification."}],
 unresolvedQuestions:["Independent expert reference?"],summary:"Fixed public CT research only, not a diagnosis."
 })}}],
});
test("Gemini and Opus independently critique same source-only real pretrained facts",async()=>{
 const calls:AiGatewayRequest[]=[];
 const fake=async (r:AiGatewayRequest)=>{
  calls.push(r);
  return r.model===GEMINI_MODEL?reply("real-prediction","high"):reply("real-prediction","low");
 };
 const result=await reviewPublicDetectorsWithTwoLlms(study,"polza",fake);
 assert.deepEqual(calls.map(x=>x.model),[GEMINI_MODEL,OPUS_MODEL]);
 assert.deepEqual(calls.map(x=>x.role),["reasoning","reasoning"]);
 assert.ok(calls.every(x=>String(x.messages[1].content).includes("Pretrained research model score 0.81")));
 assert.ok(calls.every(x=>!String(x.messages[1].content).includes(study.sourceUrl)));
 assert.ok(calls.every(x=>!String(x.messages[1].content).includes(study.title)));
 assert.ok(calls.every(x=>!String(x.messages[1].content).includes("PatientName")));
 assert.equal(result.priorityConflicts.length,1);
 assert.equal(result.priorityConflicts[0].factId,"real-prediction");
 assert.deepEqual(result.notCrossValidated,["reference-missing"]);
 assert.equal(result.patientDataTransmitted,false);
 assert.equal(result.originalCTImagesTransmitted,false);
 assert.equal(result.newModelInferencePerformed,false);
 assert.equal(result.physicianReviewRequired,true);
 assert.equal(result.clinicalStatus,"unverified_research_draft");
});
test("Missing or forged public evidence cannot call remote LLM",async()=>{
 let calls=0;
 for(const forged of [
  {...study,patientStudyAnalyzed:true},
  {...study,clinicalValidation:true},
  {...study,liveInference:true},
  {...study,facts:[]},
 ])await assert.rejects(
  reviewPublicDetectorsWithTwoLlms(forged as PublicResearchCase,"polza",async()=>{
   calls++;return reply("real-prediction","low");
  }));
 assert.equal(calls,0);
});
test("Invented LLM evidence IDs abort both reviewers and never invent findings",async()=>{
 await assert.rejects(
  reviewPublicDetectorsWithTwoLlms(study,"openrouter",async r=>
   r.model===GEMINI_MODEL?reply("invented-disease","high"):reply("real-prediction","low")),
  /unbound_llm_fact/);
});
test("Incomplete/failed LLM responses never become clinical results",async()=>{
 await assert.rejects(
  reviewPublicDetectorsWithTwoLlms(study,"polza",async r=>
   r.model===GEMINI_MODEL?{choices:[{finish_reason:"length",message:{content:"{}"}}]}:
     reply("reference-missing","high")),
  /incomplete/);
});
test("Disagreement is preserved and matching votes are not clinical proof",()=>{
 const build=(priority:"high"|"low"):PublicLLMReview=>({
  schema:"opus-public-llm-review/v1",summary:"Research draft only",
  unresolvedQuestions:[],
  rankedFacts:[{factId:"real-prediction",priority,reason:"Expert review required"}],
 });
 assert.deepEqual(reconcileDualReviews(study,build("high"),build("high")),[]);
 assert.equal(reconcileDualReviews(study,build("high"),build("low")).length,1);
 assert.throws(()=>reconcileDualReviews(study,{
  ...build("high"),rankedFacts:[{factId:"missing",priority:"high",reason:"Invented"}]
 },build("low")) ,/unbound/);
});
