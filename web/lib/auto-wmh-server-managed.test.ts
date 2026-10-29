import test from "node:test";
import assert from "node:assert/strict";
import {readyWmhOriginal} from "./auto-wmh-ready.ts";
const valid={schema:"opus-direct-wmh-worker/v1",originalModelReady:true,patientMode:false,imageUpload:true,dataPolicy:"approved-public-research-only",modelVersion:"1.6.0"};
test("automatic original WMH requires actual installed model and public research policy",()=>{
 assert.equal(readyWmhOriginal(valid),true);
 for(const [key,value] of Object.entries({originalModelReady:false,patientMode:true,imageUpload:false,dataPolicy:"patient",modelVersion:"unknown"}))
  assert.equal(readyWmhOriginal({...valid,[key]:value}),false,key);
});
