import test from "node:test";
import assert from "node:assert/strict";
import {checkAutomaticEffusionReady,originalEffusionViaServer,effusionTransferHeaders} from "./real-effusion-worker.ts";

const oldFetch=globalThis.fetch;
test("No installed original task315 -> no falsely advertised automatic readiness",async()=>{
 globalThis.fetch=async()=>new Response(JSON.stringify({detail:"unverified"}),{status:503});
 try{assert.equal(await checkAutomaticEffusionReady(),false);}
 finally{globalThis.fetch=oldFetch;}
});
test("Actual auto-original pleural/pericardial worker is same-origin only without secrets",async()=>{
 const requests:Array<{url:string;init:RequestInit}>=[];
 globalThis.fetch=async(input,init)=>{
  requests.push({url:String(input),init:init??{}});
  return new Response(JSON.stringify({schema:"unknown"}),{status:200});
 };
 try{
  await originalEffusionViaServer("/v1/effusion/capabilities");
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,"/api/local-effusion");
  assert.equal(requests[0].init.method,"GET");
  assert.equal(requests[0].init.credentials,"same-origin");
  assert.doesNotMatch(JSON.stringify(requests),/Bearer|Authorization|127\.0\.0\.1:8774/);
  await assert.rejects(originalEffusionViaServer("/v1/effusion/analyze",{
   method:"POST",headers:{"Content-Type":"application/octet-stream"},
   body:"test-only",
  }),/authorization required/);
  assert.equal(requests.length,1);
  await originalEffusionViaServer("/v1/effusion/analyze",{
   method:"POST",headers:{"Content-Type":"application/octet-stream",
    "X-Opus-Source-Sha256":"e".repeat(64),
    "X-Opus-Public-Research-Authorization":"approved-nonpatient-source"},
   body:"test-only",
  });
  assert.equal(requests.length,2);
  assert.equal(requests[1].init.method,"POST");
  assert.equal(requests[1].url,"/api/local-effusion");
 }finally{globalThis.fetch=oldFetch;}
});


test("Manual direct TotalSegmentator worker still receives only original CORS-allowed headers",()=>{
 const sha="d".repeat(64);
 const direct=effusionTransferHeaders(false,sha);
 assert.deepEqual(Object.keys(direct).sort(),["Content-Type","X-Opus-Source-Sha256"].sort());
 assert.equal(direct["X-Opus-Source-Sha256"],sha);
 assert.ok(!("X-Opus-Public-Research-Authorization" in direct));
 const automated=effusionTransferHeaders(true,sha);
 assert.equal(automated["X-Opus-Public-Research-Authorization"],
   "approved-nonpatient-source");
 assert.throws(()=>effusionTransferHeaders(true,"not-a-hash"),/SHA256/);
});
