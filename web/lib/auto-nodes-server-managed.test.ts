import test from "node:test";
import assert from "node:assert/strict";
import {automaticNodesRequest,checkAutomaticNodesReady} from "./mediastinal-raidionics-worker.ts";

test("Raidionics private automatic route has fixed same-origin target and no browser token",async()=>{
 const saved=globalThis.fetch;const calls:{url:string;init:RequestInit}[]=[];
 globalThis.fetch=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(url),init:init??{}});
  return new Response(JSON.stringify({ready:false}),{status:200});
 }) as typeof fetch;
 try{
  await automaticNodesRequest("/v1/nodes/capabilities");
  assert.equal(calls[0].url,"/api/local-nodes");
  assert.equal(calls[0].init.credentials,"same-origin");
  assert.equal(calls[0].init.method,"GET");
  assert.equal(calls[0].init.headers,undefined);
  assert.equal(await checkAutomaticNodesReady(),false);
 }finally{globalThis.fetch=saved;}
});
