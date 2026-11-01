import test from "node:test";
import assert from "node:assert/strict";
import {restoreMissingClnSource,isMissingBrowserFile} from "./cln-original-source-recovery.ts";

test("original CLN source that stays readable does not trigger DICOM rebuild",async()=>{
 let rebuilds=0;
 const original={id:"sha-bound-original"};
 const result=await restoreMissingClnSource(original,async file=>{
  assert.equal(file.id,"sha-bound-original");
 },async()=>{rebuilds++;return {id:"unexpected"};});
 assert.deepEqual(result,{source:original,restored:false});
 assert.equal(rebuilds,0);
});
test("a disappeared OPFS File is reconstructed and must pass the same source checks",async()=>{
 let checked=0,rebuilds=0;
 const result=await restoreMissingClnSource({id:"missing"},async file=>{
  checked++;
  if(file.id==="missing")throw new DOMException("File unavailable","NotFoundError");
  assert.equal(file.id,"sha-bound-reconstructed-original-DICOM");
 },async()=>{rebuilds++;return {id:"sha-bound-reconstructed-original-DICOM"};});
 assert.equal(result.restored,true);
 assert.equal(result.source.id,"sha-bound-reconstructed-original-DICOM");
 assert.equal(checked,2);
 assert.equal(rebuilds,1);
});
test("a wrong CLN SHA must NOT reconstruct or grant navigation",async()=>{
 let rebuilt=false;
 await assert.rejects(restoreMissingClnSource({id:"wrong"},async()=>{
  throw new Error("Исходная КТ отличается от исследования MONAI (SHA-256).");
 },async()=>{rebuilt=true;return {id:"fake"};}),/SHA-256/);
 assert.equal(rebuilt,false);
});
test("failed source verification of rebuilt DICOM stays blocked",async()=>{
 let checks=0;
 await assert.rejects(restoreMissingClnSource({id:"missing"},async()=>{
  checks++;
  if(checks===1)throw new DOMException("Missing","NotFoundError");
  throw new Error("restored bytes do not match CLN SHA-256");
 },async()=>({id:"different-volume"})),/SHA-256/);
 assert.equal(checks,2);
 assert.equal(isMissingBrowserFile(new Error("SHA mismatch")),false);
 assert.equal(isMissingBrowserFile(new DOMException("Missing","NotFoundError")),true);
});
