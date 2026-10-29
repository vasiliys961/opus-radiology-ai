import test from "node:test";
import assert from "node:assert/strict";
import {checkAutomaticIchReady,ichRequest} from "./public-ich-worker.ts";
test("ICH automatic bridge uses fixed same-origin path without clinician token",async()=>{
 const saved=globalThis.fetch;const calls:{url:string;init:RequestInit}[]=[];
 globalThis.fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(url),init:init??{}});
  return new Response(JSON.stringify({ready:false}),{status:200});
 }) as typeof fetch;
 try{
  await ichRequest(null,"/v1/ich/capabilities");
  assert.equal(calls[0].url,"/api/local-ich/v1/ich/capabilities");
  assert.equal(calls[0].init.credentials,"same-origin");
  assert.equal(calls[0].init.headers,undefined);
  assert.equal(await checkAutomaticIchReady(),false);
  await assert.rejects(ichRequest(null,"/v1/ich/jobs/../../secrets"));
  assert.equal(calls.length,2);
 }finally{globalThis.fetch=saved;}
});
