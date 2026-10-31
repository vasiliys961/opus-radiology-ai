import test from "node:test";
import assert from "node:assert/strict";
import {callAiGateway, type AiGatewayRequest} from "./ai-gateway.ts";

const request: AiGatewayRequest = {
  provider:"openrouter",role:"vision",model:"google/synthetic-test",
  temperature:0,messages:[
    {role:"system",content:"Synthetic geometry only"},
    {role:"user",content:[{type:"text",text:"MATHEMATICAL PHANTOM"}]},
  ],
};
test("Selected evaluator versions omit unsupported temperature on Polza while retaining the output cap",async()=>{
  const oldKey=process.env.POLZA_API_KEY,oldFetch=globalThis.fetch;
  process.env.POLZA_API_KEY="polza-fixture";
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),"https://polza.ai/api/v1/chat/completions");
    const data=JSON.parse(String(options?.body));assert.ok(["openai/gpt-6.1-sol","anthropic/claude-sonnet-5.5","anthropic/claude-opus-5.5"].includes(data.model));
    assert.equal(Object.hasOwn(data,"temperature"),false);assert.equal(data.max_tokens,1200);
    return new Response(JSON.stringify({choices:[]}));
  };
  try{for(const model of ["openai/gpt-6.1-sol","anthropic/claude-sonnet-5.5","anthropic/claude-opus-5.5"])
    await callAiGateway({...request,provider:"polza",model});}
  finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.POLZA_API_KEY;else process.env.POLZA_API_KEY=oldKey;}
});
test("Provider gateway transmits configured server bearer and bounded token request",async()=>{
  const oldKey=process.env.OPENROUTER_API_KEY;
  const fetchOld=globalThis.fetch;
  let call=0;
  process.env.OPENROUTER_API_KEY="synthetic-non-patient-key";
  globalThis.fetch=async(url,opts)=>{
    call++;
    assert.equal(String(url),"https://openrouter.ai/api/v1/chat/completions");
    assert.equal(opts?.method,"POST");
    assert.equal((opts?.headers as Record<string,string>).Authorization,
      "Bearer synthetic-non-patient-key");
    assert.equal(opts?.cache,"no-store");
    const data=JSON.parse(String(opts?.body));
    assert.equal(data.max_tokens,1200);
    assert.equal(data.model,"google/synthetic-test");
    assert.deepEqual(data.messages,request.messages);
    return new Response(JSON.stringify({model:"google/synthetic-test",
      choices:[{finish_reason:"stop",message:{content:"{}"}}],
      usage:{prompt_tokens:10,completion_tokens:1}}));
  };
  try{
    const response=await callAiGateway(request);
    assert.equal(call,1);
    assert.equal(response.model,"google/synthetic-test");
    assert.equal(JSON.stringify(response).includes("synthetic-non-patient-key"),false);
  }finally{
    globalThis.fetch=fetchOld;
    if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY=oldKey;
  }
});
test("Key missing prevents network call",async()=>{
  const oldKey=process.env.OPENROUTER_API_KEY;
  const fetchOld=globalThis.fetch;
  delete process.env.OPENROUTER_API_KEY;
  let called=false;
  globalThis.fetch=async()=>{called=true;throw new Error("never called");};
  try{
    await assert.rejects(callAiGateway(request),/not configured/);
    assert.equal(called,false);
  }finally{
    globalThis.fetch=fetchOld;
    if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY=oldKey;
  }
});
test("Gateway reveals neither provider response body nor server key on rejection",async()=>{
  const oldKey=process.env.OPENROUTER_API_KEY;
  const fetchOld=globalThis.fetch;
  process.env.OPENROUTER_API_KEY="synthetic-test-secret";
  globalThis.fetch=async()=>new Response("secret response data",{
    status:402,headers:{"content-type":"text/plain"},
  });
  try{
    await assert.rejects(callAiGateway(request),e=>
      e instanceof Error && /HTTP 402/.test(e.message) &&
      !e.message.includes("secret"));
  }finally{
    globalThis.fetch=fetchOld;
    if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY=oldKey;
  }
});

test("Strict OpenRouter schema reaches only schema-supporting endpoints with bounded tokens",async()=>{
 const oldKey=process.env.OPENROUTER_API_KEY,oldFetch=globalThis.fetch;
 process.env.OPENROUTER_API_KEY="synthetic-key";
 let calls=0;
 const format={type:"json_schema" as const,json_schema:{
  name:"synthetic_source_frame",strict:true as const,
  schema:{type:"object",properties:{reviewedImageIds:{type:"array",items:{type:"string"}}},
   required:["reviewedImageIds"],additionalProperties:false},
 }};
 globalThis.fetch=async(_url,opts)=>{
  calls++;
  const data=JSON.parse(String(opts?.body));
  assert.deepEqual(data.response_format,format);
  assert.deepEqual(data.provider,{require_parameters:true});
  assert.equal(data.max_tokens,1800);
  assert.equal(data.model,"google/gemini-3.8-flash");
  return new Response(JSON.stringify({model:data.model,choices:[
   {finish_reason:"stop",message:{content:'{"reviewedImageIds":["frame-1"]}'}}]}));
 };
 try{
  const output=await callAiGateway({...request,model:"google/gemini-3.8-flash",
    responseFormat:format,requireParameters:true,maxTokens:1800});
  assert.equal(output.choices.length,1);
  assert.equal(calls,1);
  await assert.rejects(
   callAiGateway({...request,model:"google/gemini-3.8-flash",responseFormat:format}),
   /compatible OpenRouter endpoint/);
  assert.equal(calls,1,"Structured request without endpoint enforcement must fail locally");
  await assert.rejects(
   callAiGateway({...request,provider:"polza",responseFormat:format,requireParameters:true}),
   /compatible OpenRouter endpoint/);
  assert.equal(calls,1);
 }finally{
  globalThis.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY=oldKey;
 }
});
