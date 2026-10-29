import test from "node:test";
import assert from "node:assert/strict";
import {automaticBrainRequest,checkAutomaticBrainReady} from "./brain-multisequence-original-worker.ts";
test("ISLES/BraTS automatic bridge stays same-origin, uses no browser worker token",async()=>{
 const old=globalThis.fetch;const requests:{url:string;init:RequestInit}[]=[];
 globalThis.fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  requests.push({url:String(url),init:init??{}});
  return new Response(JSON.stringify({ready:false}),{status:200});
 }) as typeof fetch;
 try{
  await automaticBrainRequest("/v1/brain/capabilities");
  assert.equal(requests[0].url,"/api/local-brain");
  assert.equal(requests[0].init.method,"GET");
  assert.equal(requests[0].init.credentials,"same-origin");
  assert.equal(requests[0].init.headers,undefined);
  assert.equal(await checkAutomaticBrainReady("stroke"),false);
  assert.equal(await checkAutomaticBrainReady("glioma"),false);
 }finally{globalThis.fetch=old;}
});
