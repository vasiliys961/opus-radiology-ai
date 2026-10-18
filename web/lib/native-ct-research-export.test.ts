import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {saveExactNativeCt,publicNoduleAdmission,type LocalFileWriter} from "./native-ct-research-export.ts";
import type {FullCtStream} from "./full-ct-stream.ts";

function setup({changed=false,truncate=false}={}){
  const bytes=[new Uint8Array(352),new Uint8Array(8*8*8*4)];
  bytes[1].fill(123);
  const digest=createHash("sha256").update(bytes[0]).update(bytes[1]).digest("hex");
  const sha=changed?"f".repeat(64):digest;
  let closed=0,aborted=0;const written:Uint8Array[]=[];
  const writer:LocalFileWriter={
    async write(chunk){written.push(new Uint8Array(chunk.slice(0)));},
    async close(){closed++;},async abort(){aborted++;},
  };
  const packet={
    byteLength:352+8*8*8*4,
    request:{
      schema:"opus-analysis-request/v2",modality:"CT",frameCount:8,
      scope:"selected-series-only",inputSha256:sha,
      sourceIdentitySha256:"a".repeat(64),
      input:{format:"NIfTI-1",datatype:"float32"},
      geometry:{dimensions:[8,8,8],affineLps:[1,0,0,0,0,1,0,0,0,0,1,0]},
    },
    async *chunks(signal:AbortSignal){
      if(signal.aborted)throw new Error("abort");
      yield bytes[0].buffer;
      if(!truncate)yield bytes[1].buffer;
    }
  } as unknown as FullCtStream;
  return{packet,writer,digest,stats:()=>({closed,aborted,written})};
}
test("exact 3D CT streaming writes local bytes, verifies second pass and yields MONAI admission",async()=>{
 const f=setup(),p=await saveExactNativeCt(f.packet,f.writer,new AbortController().signal);
 assert.equal(p.sourceNiftiSha256,f.digest);
 assert.equal(p.writtenBytes,352+8*8*8*4);
 assert.equal(f.stats().closed,1);assert.equal(f.stats().aborted,0);
 assert.equal(f.stats().written.length,2);
 assert.equal(createHash("sha256").update(Buffer.concat(f.stats().written.map(x=>Buffer.from(x)))).digest("hex"),f.digest);
 const admission=publicNoduleAdmission(p);
 assert.equal(admission.sourceNiftiSha256,f.digest);
 assert.equal(admission.cloudUploadAuthorized,false);
 assert.equal(admission.fullChestAnatomicalCoverageVerified,false);
});
test("refuses source-digest drift and aborts temporary local file",async()=>{
 const f=setup({changed:true});
 await assert.rejects(()=>saveExactNativeCt(f.packet,f.writer,new AbortController().signal),/SHA-256/);
 assert.equal(f.stats().closed,0);assert.equal(f.stats().aborted,1);
});
test("truncated full CT is not committed",async()=>{
 const f=setup({truncate:true});
 await assert.rejects(()=>saveExactNativeCt(f.packet,f.writer,new AbortController().signal),/Повторное чтение/);
 assert.equal(f.stats().closed,0);assert.equal(f.stats().aborted,1);
});
test("cancelled export cannot commit any file",async()=>{
 const f=setup(),controller=new AbortController();
 await assert.rejects(()=>saveExactNativeCt(f.packet,f.writer,controller.signal,()=>controller.abort()),/отменён/);
 assert.equal(f.stats().closed,0);assert.equal(f.stats().aborted,1);
});
