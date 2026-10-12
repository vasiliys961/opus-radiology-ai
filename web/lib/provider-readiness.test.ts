import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOpenRouterModels, compareConfiguredRoles, readBoundedJson, inspectProvider,
  preferredCatalogueModels,
  type ProviderEnv,
} from "./provider-readiness.ts";

const env: ProviderEnv = {
  OPENROUTER_API_KEY: "secret-key-must-not-be-exposed",
  RADIOLOGY_OPENROUTER_VISION_MODEL: "google/vision-test",
  RADIOLOGY_OPENROUTER_CLINICAL_MODEL: "openai/text-test",
  POLZA_API_KEY: "secret-polza-key",
  RADIOLOGY_POLZA_VISION_MODEL: "model-a",
};
const catalog = {
  data: [
    {id:"google/vision-test", name:"Vision Test", architecture:{
      input_modalities:["text","image"], output_modalities:["text"]}},
    {id:"openai/text-test", name:"Text Test", architecture:{
      input_modalities:["text"], output_modalities:["text"]}},
    {id:"vendor/image-only", name:"Image maker", architecture:{
      input_modalities:["text"], output_modalities:["image"]}},
    {id:"vendor/missing-architecture", name:"Unknown"},
    {id:"google/vision-test", name:"Duplicate", architecture:{
      input_modalities:["text","image"], output_modalities:["text"]}},
  ],
};
function mockFetch(payload: unknown = catalog, status = 200) {
  const seen: { url?: string; init?: RequestInit } = {};
  const stub: typeof fetch = async (url, init) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(payload), {
      status, headers: {"Content-Type":"application/json"},
    });
  };
  return {seen, stub};
}

test("Catalogue reads explicit image/text modality descriptors only", () => {
  const models = parseOpenRouterModels(catalog);
  assert.equal(models.length, 3);
  assert.equal(models[0].acceptsImages, true);
  assert.equal(models[1].acceptsImages, false);
  assert.equal(models[2].producesText, false);
  assert.throws(() => parseOpenRouterModels({data:[{id:"notvalid"}]}));
  assert.throws(() => parseOpenRouterModels({data:[]}));
  assert.throws(() => parseOpenRouterModels({data:"not-an-array"}));
});
test("Configured Vision must explicitly accept images and produce text", () => {
  const all = parseOpenRouterModels(catalog);
  const good = compareConfiguredRoles("google/vision-test","openai/text-test",all);
  assert.equal(good.vision.matchingModality,true);
  assert.equal(good.clinical.matchingModality,true);
  const bad = compareConfiguredRoles("openai/text-test","vendor/image-only",all);
  assert.equal(bad.vision.matchingModality,false);
  assert.equal(bad.clinical.matchingModality,false);
  assert.equal(compareConfiguredRoles("unknown/id",null,all).vision.inCatalogue,false);
});
test("Server uses pinned public catalogue URL and never returns credential", async () => {
  const {seen,stub} = mockFetch();
  const report = await inspectProvider("openrouter",env,stub);
  assert.equal(report.schema,"opus-provider-readiness/v1");
  assert.equal(report.catalogStatus,"verified-response");
  assert.equal(report.keyConfigured,true);
  assert.equal(report.vision.modelId,"google/vision-test");
  assert.equal(report.vision.inCatalogue,true);
  assert.equal(report.vision.matchingModality,true);
  assert.equal(report.clinical.matchingModality,true);
  assert.equal(report.suggestions.vision.length,0); // arbitrary catalogue examples are not the chosen profile
  assert.equal(report.patientImagesAllowed,false);
  assert.equal(report.inferenceAllowed,false);
  assert.equal(seen.url,"https://openrouter.ai/api/v1/models");
  assert.equal(seen.init?.method,"GET");
  assert.equal((seen.init?.headers as Record<string,string>).Authorization,
    "Bearer secret-key-must-not-be-exposed");
  const wire=JSON.stringify(report);
  assert.equal(wire.includes("secret-key-must-not-be-exposed"),false);
  assert.equal(wire.includes("secret-polza-key"),false);
});
test("No key stops external network and never prints untrusted env model ID", async () => {
  let calls=0;
  const output=await inspectProvider("openrouter",{
    ...env, OPENROUTER_API_KEY:"", RADIOLOGY_OPENROUTER_VISION_MODEL:"too many spaces & forbidden\n",
  },async()=>{calls++;throw new Error("should not fetch")});
  assert.equal(calls,0);
  assert.equal(output.catalogStatus,"disabled");
  assert.equal(output.keyConfigured,false);
  assert.equal(output.vision.modelId,null);
});
test("Polza uses its documented catalogue endpoint and its own key without provider substitution", async () => {
  const {seen,stub}=mockFetch();const data=await inspectProvider("polza",env,stub);
  assert.equal(data.catalogStatus,"verified-response");
  assert.equal(data.vision.modelId,"model-a");
  assert.equal(data.vision.matchingModality,false);
  assert.equal(seen.url,"https://polza.ai/api/v1/models");
  assert.equal((seen.init?.headers as Record<string,string>).Authorization,"Bearer secret-polza-key");
  assert.equal(seen.init?.redirect,"error");
  assert.equal(data.inferenceAllowed,false);
});
test("Network failures have bounded, secret-free, non-fatal report", async () => {
  const output=await inspectProvider("openrouter",env,async()=>{
    throw new Error("secret-key-must-not-be-exposed private transport stack");
  });
  assert.equal(output.catalogStatus,"unavailable");
  assert.equal(output.keyConfigured,true);
  assert.equal(JSON.stringify(output).includes("secret-key-must-not-be-exposed"),false);
  const denied=await inspectProvider("openrouter",env,mockFetch({error:"no access"},401).stub);
  assert.equal(denied.catalogStatus,"unavailable");
});
test("Oversized provider catalogue is refused regardless of declared length", async () => {
  const data=JSON.stringify({data:[{id:"google/a",architecture:{
    input_modalities:["text","image"],output_modalities:["text"]}}],
    big:"A".repeat(8_100_000),
  });
  await assert.rejects(readBoundedJson(new Response(data)),/too large/);
  await assert.rejects(readBoundedJson(new Response("{}",{
    headers:{"content-length":"999999999"},
  })),/too large/);
});

test("Only the chosen exact profile is shown regardless of alphabetic ordering and legacy variants",async()=>{
  const many = Array.from({length:22},(_,i)=>({
    id:"anthropic/demo-"+String(i).padStart(2,"0"),
    architecture:{input_modalities:["text","image"],output_modalities:["text"]},
  }));
  const synthetic={data:[
    ...many,
    {id:"google/gemini-3.8-flash",architecture:{
      input_modalities:["text","image"],output_modalities:["text"]}},
    {id:"openai/gpt-6.1-sol",architecture:{
      input_modalities:["text","image"],output_modalities:["text"]}},
  ]};
  const report=await inspectProvider("openrouter",env,mockFetch(synthetic).stub);
  assert.equal(report.catalogStatus,"verified-response");
  assert.deepEqual(report.suggestions.vision.map(m=>m.id),["google/gemini-3.8-flash"]);
  assert.deepEqual(report.suggestions.clinical.map(m=>m.id),["openai/gpt-6.1-sol"]);
});
test("Missing preferred models never fall back to older, batch, image-generator or text-only entries",()=>{
  const all=parseOpenRouterModels({data:[
    {id:"google/gemini-2.5-flash",architecture:{input_modalities:["image","text"],output_modalities:["text"]}},
    {id:"google/gemini-3.8-flash:batch",architecture:{input_modalities:["image","text"],output_modalities:["text"]}},
    {id:"anthropic/claude-sonnet-5.5",architecture:{input_modalities:["text"],output_modalities:["text"]}},
    {id:"openai/gpt-6.1-sol",architecture:{input_modalities:["text","image"],output_modalities:["image"]}},
  ]});
  assert.deepEqual(preferredCatalogueModels("vision",all),[]);
  assert.deepEqual(preferredCatalogueModels("clinical",all),[]);
});
