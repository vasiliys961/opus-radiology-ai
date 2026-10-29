import test from "node:test";
import assert from "node:assert/strict";
import {automaticPeRequest,checkAutomaticPeReady} from "./pe-ctpa-direct-worker.ts";
test("automatic PE uses only same-origin fixed URL and no doctor token",async()=>{
 const before=globalThis.fetch;
 const calls:{url:string;init:RequestInit}[]=[];
 globalThis.fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(url),init:init??{}});
  return new Response(JSON.stringify({ready:false}),{status:200});
 }) as typeof fetch;
 try{
  await automaticPeRequest("/v1/pe/capabilities");
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"/api/local-pe");
  assert.equal(calls[0].init.method,"GET");
  assert.equal(calls[0].init.credentials,"same-origin");
  assert.equal(calls[0].init.redirect,"error");
  assert.equal(calls[0].init.headers,undefined);
  assert.equal(await checkAutomaticPeReady(),false);
 }finally{globalThis.fetch=before;}
});
