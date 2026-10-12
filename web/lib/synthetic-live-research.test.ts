import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {syntheticVisionFrames, SYNTHETIC_REGIONS} from "./synthetic-vision-phantom.ts";
import {
  executeSyntheticTrial, parseSyntheticTrialInput, createSyntheticTrialLimiter,
  SyntheticTrialFailure, SYNTHETIC_TRIAL_MAX_COMPLETIONS,
} from "./synthetic-live-research.ts";
import type {CompletionCaller} from "./vision-orchestra.ts";

const input = {
  modality:"CT" as const,region:"head" as const,
  visionModel:"google/gemini-3.8-flash",clinicalModel:"anthropic/claude-sonnet-5.5",
  acknowledgePaidSyntheticExperiment:true as const,
};
const env = {OPENROUTER_API_KEY:"fixture-server-secret"};
const catalog = {data:[
  {id:"google/gemini-3.8-flash",name:"Synthetic Vision Provider",
    architecture:{input_modalities:["image","text"],output_modalities:["text"]}},
  {id:"anthropic/claude-sonnet-5.5",name:"Synthetic Text Provider",
    architecture:{input_modalities:["text","image"],output_modalities:["text"]}},
  {id:"vendor/no-vision",name:"Text only",
    architecture:{input_modalities:["text"],output_modalities:["text"]}},
]};
let catalogCalls=0;
const catalogueFetch: typeof fetch = async (url,options) => {
  catalogCalls++;
  assert.equal(String(url),"https://openrouter.ai/api/v1/models");
  assert.equal(options?.method,"GET");
  assert.equal((options?.headers as Record<string,string>).Authorization,
    "Bearer fixture-server-secret");
  return new Response(JSON.stringify(catalog));
};
const response=(payload:unknown)=>({
  choices:[{finish_reason:"stop",message:{content:JSON.stringify(payload)}}],
});
const calls:{role:string;model:string;content:unknown}[]=[];
const modelCall:CompletionCaller = async request=>{
  calls.push({role:request.role,model:request.model,content:request.messages[1].content});
  if(request.role==="reasoning")
    return response({summary:"Mathematical phantom with geometric contours, not a medical scan.",
      limitations:["Synthetic image only","Not a real study"]});
  const system=String(request.messages[0].content);
  if(system.includes("Independent evidence critic"))
    return response({needsRecheck:["synthetic-brain-0"],conflicts:[],
      limitations:["Geometric schematic only"]});
  const role=system.includes('"role":"anatomy"')?"anatomy":
    system.includes('"role":"observations"')?"observations":"quality";
  return response({
    role,reviewedImageIds:["synthetic-brain-0","synthetic-brain-1"],
    observations:role==="anatomy" ? [{
      id:"ellipses",imageId:"synthetic-brain-0",anatomy:"artificial ellipse",
      sign:"Two shaded ellipses visible",uncertainty:"Nonclinical mathematical phantom",
    }] :[],
    limitations:["No medical images supplied"],
  });
};

test("Reject any clinical content, extra keys, arbitrary frames or missing cost confirmation",()=>{
  assert.deepEqual(parseSyntheticTrialInput(input),input);
  assert.equal(parseSyntheticTrialInput({...input,patientName:"Patient X"}),null);
  assert.equal(parseSyntheticTrialInput({...input,base64:"abc"}),null);
  assert.equal(parseSyntheticTrialInput({...input,images:[]}),null);
  assert.equal(parseSyntheticTrialInput({...input,clinicalContext:"headache"}),null);
  assert.equal(parseSyntheticTrialInput({...input,acknowledgePaidSyntheticExperiment:false}),null);
  assert.equal(parseSyntheticTrialInput({...input,visionModel:"http://internal"}),null);
  assert.equal(parseSyntheticTrialInput({...input,region:"knee"}),null);
  assert.equal(parseSyntheticTrialInput({...input,modality:"US"}),null);
  assert.equal(parseSyntheticTrialInput(null),null);
  assert.equal(parseSyntheticTrialInput([]),null);
});
test("All six region/modality combinations generate real distinct PNG phantoms without patient input",()=>{
  const images=new Set<string>();
  for(const modality of ["CT","MR"] as const)
    for(const region of SYNTHETIC_REGIONS) {
      const frames=syntheticVisionFrames(modality,region);
      assert.equal(frames.length,2);
      for(const frame of frames) {
        assert.match(frame.viewLabel,/NON-PATIENT MATHEMATICAL PHANTOM/);
        assert.match(frame.viewLabel,/NOT CLINICAL/);
        const png=Buffer.from(frame.base64,"base64");
        assert.equal(png.subarray(1,4).toString(),"PNG");
        assert.equal(png.readUInt32BE(16),96);
        assert.equal(png.readUInt32BE(20),96);
        assert.ok(png.length<120_000);
        images.add(createHash("sha256").update(png).digest("hex"));
      }
    }
  assert.equal(images.size,6); // two slices × three regions, images do not depend on modality label
});
test("Server checks models in live catalogue and calls five bounded roles on generated PNGs",async()=>{
  catalogCalls=0;calls.length=0;
  const trial=await executeSyntheticTrial(input,env,catalogueFetch,modelCall);
  assert.equal(trial.schema,"opus-synthetic-trial/v1");
  assert.equal(trial.region,"head");
  assert.equal(trial.patientDataSubmitted,false);
  assert.equal(trial.remoteInferencePerformed,true);
  assert.equal(catalogCalls,1);
  assert.equal(calls.length,SYNTHETIC_TRIAL_MAX_COMPLETIONS);
  assert.deepEqual(calls.map(c=>c.role),["vision","vision","vision","vision","reasoning"]);
  assert.deepEqual(calls.map(c=>c.model),[input.visionModel,input.visionModel,input.visionModel,input.clinicalModel,input.clinicalModel]);
  assert.ok(calls.filter(c=>c.role==="vision").every(c=>
    Array.isArray(c.content) && c.content.some((part:{type?:string})=>part.type==="image_url")));
  assert.equal(trial.result.clinicalStatus,"unverified_research_draft");
  assert.equal(trial.result.evidence.findings[0].status,"requires_recheck");
  assert.equal(trial.result.evidence.findings[0].measurements.diameterMm,null);
  assert.equal(trial.result.sourceImages.length,2);
  assert.ok(trial.result.sourceImages.every(f=>!("base64" in f)));
  assert.equal(JSON.stringify(trial).includes("fixture-server-secret"),false);
});
test("Missing provider key is rejected before any external request",async()=>{
  let catalogCount=0;let modelCount=0;
  await assert.rejects(executeSyntheticTrial(input,{},async()=>{
    catalogCount++;throw new Error("must not fetch");
  },async()=>{modelCount++;throw new Error("must not call");}), (e:unknown)=>
    e instanceof SyntheticTrialFailure && e.code==="no-key");
  assert.equal(catalogCount,0);assert.equal(modelCount,0);
});
test("Selected text-only Vision ID cannot trigger any paid model calls",async()=>{
  let callCount=0;
  await assert.rejects(executeSyntheticTrial(
    {...input,visionModel:"vendor/no-vision"},env,catalogueFetch,async()=>{
      callCount++;throw new Error("must not call");
    }), (e:unknown)=>e instanceof SyntheticTrialFailure && e.code==="unsupported-model");
  assert.equal(callCount,0);
});
test("Unknown model and missing catalogue halt before model inference",async()=>{
  await assert.rejects(executeSyntheticTrial(
    {...input,clinicalModel:"provider/invented"},env,catalogueFetch,modelCall),
    (e:unknown)=>e instanceof SyntheticTrialFailure && e.code==="unsupported-model");
  await assert.rejects(executeSyntheticTrial(input,env,async()=>{
    throw new Error("secret fixture error");
  },modelCall), (e:unknown)=>e instanceof SyntheticTrialFailure && e.code==="catalog-unavailable");
});
test("Per-process rate limiter allows only one running call and four in 10 minutes",()=>{
  const limiter=createSyntheticTrialLimiter(4,600_000);
  const release1=limiter.acquire(0);assert.equal(typeof release1,"function");
  assert.equal(limiter.acquire(1),null);
  release1?.();
  const release2=limiter.acquire(2);assert.equal(typeof release2,"function");
  release2?.();
  const release3=limiter.acquire(3);release3?.();
  const release4=limiter.acquire(4);release4?.();
  assert.equal(limiter.acquire(5),null);
  const release5=limiter.acquire(600_001);assert.equal(typeof release5,"function");
  release5?.();
});
test("Polza synthetic execution uses the chosen provider key/catalogue and never switches to OpenRouter",async()=>{
  const received:string[]=[];calls.length=0;
  const result=await executeSyntheticTrial({...input,provider:"polza"},{POLZA_API_KEY:"polza-fixture",OPENROUTER_API_KEY:"do-not-use"},
    async(url,options)=>{received.push(String(url));assert.equal((options?.headers as Record<string,string>).Authorization,"Bearer polza-fixture");
      return new Response(JSON.stringify(catalog));},async(request,signal)=>{assert.equal(request.provider,"polza");return modelCall(request,signal);});
  assert.deepEqual(received,["https://polza.ai/api/v1/models"]);assert.equal(result.result.provider,"polza");assert.equal(calls.length,5);
});
test("Curated-only parsing refuses legacy/batch/self-critic substitutions and invalid providers",()=>{
  for(const changed of [{visionModel:"google/gemini-2.5-flash"},{visionModel:input.visionModel+":batch"},
    {clinicalModel:input.visionModel},{clinicalModel:"openai/gpt-3.5-turbo"},{provider:"unknown"}])
    assert.equal(parseSyntheticTrialInput({...input,...changed}),null);
});
test("Selected evaluator must accept images before any paid calls",async()=>{
  let paid=0;
  const textOnly={data:catalog.data.map(m=>m.id===input.clinicalModel?{...m,architecture:{input_modalities:["text"],output_modalities:["text"]}}:m)};
  await assert.rejects(executeSyntheticTrial(input,env,async()=>new Response(JSON.stringify(textOnly)),async()=>{paid++;throw new Error("must not call");}),
    (e:unknown)=>e instanceof SyntheticTrialFailure&&e.code==="unsupported-model");assert.equal(paid,0);
  const imageOnly={data:catalog.data.map(m=>m.id===input.visionModel?{...m,architecture:{input_modalities:["image"],output_modalities:["text"]}}:m)};
  await assert.rejects(executeSyntheticTrial(input,env,async()=>new Response(JSON.stringify(imageOnly)),async()=>{paid++;throw new Error("must not call");}),
    (e:unknown)=>e instanceof SyntheticTrialFailure&&e.code==="unsupported-model");assert.equal(paid,0);
});
