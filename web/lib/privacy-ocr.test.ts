import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizePrivacyOcr,scanPrivacyText } from "./privacy-ocr.ts";
import { acquireBrowserCompute } from "./browser-compute-slot.ts";
import { OCR_ASSETS,OCR_HOST_SCRIPT,OCR_NETWORK_GUARD } from "./privacy-ocr-assets.ts";
import type { PrivacyFrame } from "./vision-privacy.ts";
import { createPrivacyFrame } from "./vision-privacy.ts";
import { OCR_TIMEOUT_MS } from "./privacy-ocr.ts";
const frame={frameId:"frame-1",modality:"CT",width:100,height:80,sha256:"a".repeat(64)} as PrivacyFrame;

test("OCR allowlists only bounded native rectangles; no recognized text or opaque fields read",()=>{
  const word={bbox:{x0:1,y0:2,x1:99,y1:79},confidence:0};
  Object.defineProperty(word,"text",{enumerable:true,get(){throw Error("PHI text must not reach parent state");}});
  const result=normalizePrivacyOcr({sha256:frame.sha256,boxes:[word]},frame);
  assert.deepEqual(result.regions,[{rectangle:{x:0,y:0,width:100,height:80},confidence:0}]);
  assert.doesNotMatch(JSON.stringify(result),/text|bbox/);
});
test("foreign SHA, invalid output and excessive/off-grid OCR boxes fail closed",()=>{
  const valid={bbox:{x0:5,y0:5,x1:10,y1:10},confidence:75};
  for(const value of [null,{sha256:"f".repeat(64),boxes:[]},{sha256:frame.sha256,boxes:null},
    {sha256:frame.sha256,boxes:Array(65).fill(valid)},
    ...[{x0:-1},{x1:101},{x1:5},{y1:81},{x0:0.5}].map(change=>({sha256:frame.sha256,boxes:[{...valid,bbox:{...valid.bbox,...change}}]})),
    {sha256:frame.sha256,boxes:[{...valid,confidence:NaN}]}])assert.throws(()=>normalizePrivacyOcr(value,frame));
  assert.deepEqual(normalizePrivacyOcr({sha256:frame.sha256,boxes:[]},frame).regions,[]);
});
test("same-tab OCR/R231 lease refuses overlap and stale release cannot unlock a newer job",async()=>{
  const first=acquireBrowserCompute("local-r231");
  assert.throws(()=>acquireBrowserCompute("privacy-ocr"),/Дождитесь/);first();
  const second=acquireBrowserCompute("privacy-ocr");first();
  assert.throws(()=>acquireBrowserCompute("local-r231"),/Дождитесь/);second();
  await assert.rejects(scanPrivacyText({...frame,pngBase64:"invalid",redactions:[]},new AbortController().signal));
  const released=acquireBrowserCompute("local-r231");released();
});
test("deployed OCR runtime/data bytes match exact pins",async()=>{
  for(const file of Object.values(OCR_ASSETS)){
    const bytes=await readFile(join(process.cwd(),"node_modules",file.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"),file.sha256);
  }
});
test("owned host/engine scripts restrict asset GETs and suppress text-bearing logs/cache",()=>{
  assert.match(OCR_NETWORK_GUARD,/options\.body/);assert.match(OCR_NETWORK_GUARD,/credentials:'omit'/);
  assert.match(OCR_NETWORK_GUARD,/url\.origin!==assetRoot\.origin/);assert.match(OCR_HOST_SCRIPT,/cacheMethod:'none'/);
  assert.match(OCR_HOST_SCRIPT,/text:false,blocks:true/);assert.match(OCR_HOST_SCRIPT,/child\.terminate/);
  assert.doesNotMatch(OCR_HOST_SCRIPT,/word\.text|console\.log|https:\/\//);
});

test("OCR success, initial cancellation and failure terminate owned workers and release admission",async()=>{
  const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=","base64");
  const copy=createPrivacyFrame(bytes,"frame-1","CT"),original=Object.getOwnPropertyDescriptor(globalThis,"Worker");
  let mode="success",terminated=0,created=0;
  const controller=new AbortController();
  class FakeWorker{
    onmessage:((e:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;
    constructor(url:string){assert.match(url,/^\/api\/privacy-ocr\/assets\/v1\/host-worker\.js$/);created++;}
    postMessage(v:{kind:string}){
      if(v.kind==="stop")queueMicrotask(()=>this.onmessage?.({data:{kind:"stopped"}}));
      else if(mode==="abort")controller.abort();
      else queueMicrotask(()=>this.onmessage?.({data:mode==="success"?{kind:"result",sha256:copy.sha256,boxes:[]}:{kind:"failed"}}));
    }
    terminate(){terminated++;}
  }
  Object.defineProperty(globalThis,"Worker",{value:FakeWorker,configurable:true});
  try{
    assert.equal((await scanPrivacyText(copy,new AbortController().signal)).regions.length,0);
    mode="abort";await assert.rejects(scanPrivacyText(copy,controller.signal),{name:"AbortError"});
    mode="failed";await assert.rejects(scanPrivacyText(copy,new AbortController().signal),/не завершён/);
    assert.equal(created,3);assert.equal(terminated,3);
    const release=acquireBrowserCompute("local-r231");release();
  }finally{if(original)Object.defineProperty(globalThis,"Worker",original);else Reflect.deleteProperty(globalThis,"Worker");}
});

test("OCR timeout terminates a pending worker and frees the shared slot",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const copy=createPrivacyFrame(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=","base64"),"frame-1","CT");
  const original=Object.getOwnPropertyDescriptor(globalThis,"Worker");let terminated=false;
  class StalledWorker{
    onmessage:((e:{data:unknown})=>void)|null=null;
    postMessage(v:{kind:string}){if(v.kind==="stop")queueMicrotask(()=>this.onmessage?.({data:{kind:"stopped"}}));}
    terminate(){terminated=true;}
  }
  Object.defineProperty(globalThis,"Worker",{value:StalledWorker,configurable:true});
  try{
    const running=scanPrivacyText(copy,new AbortController().signal);
    const rejected=assert.rejects(running,/30 секунд/);t.mock.timers.tick(OCR_TIMEOUT_MS);await rejected;
    assert.equal(terminated,true);const release=acquireBrowserCompute("local-r231");release();
  }finally{if(original)Object.defineProperty(globalThis,"Worker",original);else Reflect.deleteProperty(globalThis,"Worker");}
});
