import test from "node:test";
import assert from "node:assert/strict";
import {autoMonaiRequest,checkAutomaticMonaiReady} from "./live-nodule-worker.ts";

test("MONAI automatic route is fixed same-origin and no credential enters fetch",async()=>{
 const previous=globalThis.fetch;
 const calls:{url:string;init:RequestInit}[]=[];
 globalThis.fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(url),init:init??{}});
  return new Response(JSON.stringify({schema:"test"}),{status:200});
 }) as typeof fetch;
 try{
  await autoMonaiRequest("/v1/nodule/capabilities");
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"/api/local-nodule/v1/nodule/capabilities");
  assert.equal(calls[0].init.credentials,"same-origin");
  assert.equal(calls[0].init.redirect,"error");
  assert.equal(calls[0].init.headers,undefined);
  await assert.rejects(autoMonaiRequest("http://evil.example/v1/nodule/upload"));
  await assert.rejects(autoMonaiRequest("/v1/nodule/jobs/../../../../secrets"));
  assert.equal(calls.length,1);
 }finally{globalThis.fetch=previous;}
});
test("MONAI automatic readiness fails closed without a live verified original checkpoint",async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=(async()=>new Response(JSON.stringify({ready:true,imageUpload:true}))) as typeof fetch;
 try{assert.equal(await checkAutomaticMonaiReady(),false);}
 finally{globalThis.fetch=previous;}
});
