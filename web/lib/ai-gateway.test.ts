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
