import test from "node:test";
import assert from "node:assert/strict";
import {acquireBrowserCompute,acquireBrowserComputeWhenAvailable} from "./browser-compute-slot.ts";
test("An OCR replacement waits for teardown without running two heavy tasks",async()=>{
 const old=acquireBrowserCompute("privacy-ocr");
 const next=acquireBrowserComputeWhenAvailable("privacy-ocr",new AbortController().signal);
 assert.equal(typeof next,"object");assert.throws(()=>acquireBrowserCompute("local-r231"));
 old();const release=await next;
 old();assert.throws(()=>acquireBrowserCompute("local-r231"),"An obsolete cleanup cannot free the next owner");
 release();const final=acquireBrowserCompute("local-r231");final();
});
test("A cancelled or timed-out OCR waiter cannot steal another owner's slot",async()=>{
 const owner=acquireBrowserCompute("local-r231");
 try{
  const controller=new AbortController();
  const pending=acquireBrowserComputeWhenAvailable("privacy-ocr",controller.signal);
  const rejected=assert.rejects(Promise.resolve(pending),{name:"AbortError"});
  controller.abort();await rejected;
  await assert.rejects(Promise.resolve(acquireBrowserComputeWhenAvailable("privacy-ocr",new AbortController().signal,10)),/занят/);
  assert.throws(()=>acquireBrowserCompute("privacy-ocr"));
 }finally{owner();}
 const clean=acquireBrowserCompute("privacy-ocr");clean();
});
