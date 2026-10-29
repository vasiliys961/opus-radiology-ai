import test from "node:test";
import assert from "node:assert/strict";
import {originalAbdomenViaServer,checkAutomaticAbdomenReady} from "./real-abdominal-worker.ts";
const original=globalThis.fetch;
test("Automatic original abdomen readiness fails closed when server unavailable",async()=>{
 globalThis.fetch=async()=>new Response(JSON.stringify({error:"not installed"}),{status:503});
 try{assert.equal(await checkAutomaticAbdomenReady(),false);}finally{globalThis.fetch=original;}
});
test("Automatic original abdomen calls ONLY same-origin server, never sends worker token",async()=>{
 const requests:{url:string;init:RequestInit}[]=[];
 globalThis.fetch=async(input,init)=>{
  requests.push({url:String(input),init:init??{}});
  return new Response(JSON.stringify({schema:"unknown"}),{status:200});
 };
 try{
  const response=await originalAbdomenViaServer("/v1/abdomen/capabilities");
  assert.equal(response.status,200);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,"/api/local-abdomen");
  assert.equal(requests[0].init.method,"GET");
  assert.equal(requests[0].init.credentials,"same-origin");
  assert.equal(requests[0].init.cache,"no-store");
  assert.doesNotMatch(JSON.stringify(requests),/Bearer|Authorization|127\.0\.0\.1:8775/);
  await assert.rejects(originalAbdomenViaServer("/v1/abdomen/analyze",{
   method:"POST",headers:{"Content-Type":"application/octet-stream"},
   body:"fake"}),/authorization required/);
  assert.equal(requests.length,1);
  await originalAbdomenViaServer("/v1/abdomen/analyze",{
   method:"POST",headers:{"Content-Type":"application/octet-stream",
    "X-Opus-Public-Research-Authorization":"approved-nonpatient-source",
    "X-Opus-Source-Sha256":"f".repeat(64)},body:"public-test-only",
  });
  assert.equal(requests.length,2);
  assert.equal(requests[1].url,"/api/local-abdomen");
  assert.equal(requests[1].init.method,"POST");
 }finally{globalThis.fetch=original;}
});
