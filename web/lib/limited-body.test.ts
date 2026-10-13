import test from "node:test";
import assert from "node:assert/strict";
import {HttpBodyTooLarge,readLimitedText} from "./limited-body.ts";

const chunks=(sizes:number[],header=false):Request=>{
  const stream=new ReadableStream<Uint8Array>({
    start(controller){
      for(const size of sizes)controller.enqueue(new Uint8Array(size).fill(120));
      controller.close();
    },
  });
  return new Request("http://localhost/api/ai/orchestrate",{
    method:"POST",body:stream,duplex:"half",
    ...(header?{headers:{"content-length":"1"}}:{}),
  } as RequestInit);
};
test("exact 2048-byte synthetic body is accepted without Content-Length",async()=>{
  const text=await readLimitedText(chunks([512,1536]),2048);
  assert.equal(text.length,2048);
});
test("missing or forged Content-Length cannot bypass the 2 KiB body cap",async()=>{
  for(const request of [chunks([1024,1025]),chunks([4096],true),chunks([64,64,3000])])
    await assert.rejects(()=>readLimitedText(request,2048),HttpBodyTooLarge);
});
test("invalid UTF-8 and empty payload fail closed",async()=>{
  const invalid=new Request("http://localhost/",{method:"POST",
    body:new Uint8Array([0xc3,0x28])});
  await assert.rejects(()=>readLimitedText(invalid,2048),TypeError);
  await assert.rejects(()=>readLimitedText(new Request("http://localhost/"),2048),/Empty HTTP body/);
});
test("limit validation never reads incoming body",async()=>{
  await assert.rejects(()=>readLimitedText(chunks([1]),0),/Invalid request limit/);
});
