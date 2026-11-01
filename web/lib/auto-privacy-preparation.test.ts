import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {readFileSync} from "node:fs";
import {autoPrepareVisionPrivacy} from "./auto-privacy-preparation.ts";
import {createPrivacyFrame,type PrivacyFrame} from "./vision-privacy.ts";
import {exportPrivacyJournal} from "./privacy-review-journal.ts";

function pngChunk(type:string,payload:Buffer){
 const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);
 length.writeUInt32BE(payload.length);
 let hash=0xffffffff;
 for(const b of Buffer.concat([name,payload])){
  hash^=b;for(let i=0;i<8;i++)hash=(hash>>>1)^((hash&1)?0xedb88320:0);
 }
 crc.writeUInt32BE((hash^0xffffffff)>>>0);
 return Buffer.concat([length,name,payload,crc]);
}
function png(rgb:number){
 const head=Buffer.alloc(13);head.writeUInt32BE(2,0);head.writeUInt32BE(2,4);head[8]=8;head[9]=6;
 const row=Buffer.from([0,rgb,rgb,rgb,255,rgb,rgb,rgb,255]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  pngChunk("IHDR",head),pngChunk("IDAT",deflateSync(Buffer.concat([row,row]))),
  pngChunk("IEND",Buffer.alloc(0))]);
}
const preview=(v:number)=>"data:image/png;base64,"+png(v).toString("base64");
test("one DICOM click auto strips metadata, OCR checks every selected PNG, no cloud clearance",async()=>{
 let calls=0;
 const result=await autoPrepareVisionPrivacy([preview(10),preview(20)],"CT",
  new AbortController().signal,()=>{},{
   scan:async f=>{calls++;return {sha256:f.sha256,regions:[]};},
   redact:async()=>{throw Error("must never redact clean images");},
  });
 assert.equal(calls,2);
 assert.equal(result.frames.length,2);
 assert.equal(result.redacted,0);
 assert.equal(result.unresolved,0);
 assert.ok(result.frames.every(f=>!f.pixelReviewSha256&&!f.visualReviewSha256));
 assert.equal(result.journal.events.filter(e=>e.action.kind==="ocr-completed").length,2);
 assert.doesNotThrow(()=>exportPrivacyJournal(result.journal,result.frames));
});
test("automatically redacts actual burned-in pixels, OCR rechecks original-bound bytes",async()=>{
 let calls=0;
 const result=await autoPrepareVisionPrivacy([preview(55)],"MR",
  new AbortController().signal,()=>{},{
   scan:async f=>{
    calls++;
    return {sha256:f.sha256,regions:calls===1?[{
      rectangle:{x:0,y:0,width:1,height:1},confidence:98}]:[]};
   },
   redact:async (f,regions)=>{
    assert.equal(regions.length,1);
    return createPrivacyFrame(png(0),f.frameId,f.modality,[...f.redactions,...regions]);
   },
  });
 assert.equal(calls,2);
 assert.equal(result.redacted,1);
 assert.equal(result.frames[0].redactions.length,1);
 assert.equal(result.ocr["frame-1"].regions.length,0);
 assert.ok(!result.frames[0].pixelReviewSha256);
 assert.deepEqual(result.journal.events.map(x=>x.action.kind),
  ["ocr-started","ocr-completed","redacted","ocr-started","ocr-completed"]);
 assert.doesNotThrow(()=>exportPrivacyJournal(result.journal,result.frames));
});
test("failed OCR aborts local privacy readiness and never creates consent",async()=>{
 await assert.rejects(
  autoPrepareVisionPrivacy([preview(1)],"CT",new AbortController().signal,
   ()=>{},{scan:async()=>{throw Error("OCR unavailable");},redact:async f=>f}),
  /OCR unavailable/);
 await assert.rejects(
  autoPrepareVisionPrivacy([preview(1),undefined],"CT",new AbortController().signal),
  /не все/i);
});

test("automatic privacy OCR retries after Strict Mode replay abort",()=>{
 const component=readFileSync(
  new URL("../components/VisionPrivacyPreparation.tsx",import.meta.url),"utf8");
 assert.match(component,/autoAttempt\.current===previews/,
  "Exact preview snapshot is leased rather than globally claimed");
 assert.match(component,/controller\.abort\(\);[\s\S]*if\(autoAttempt\.current===previews\)autoAttempt\.current=null;/,
  "Cleanup must release its aborted preview lease for React Strict Mode replay");
 assert.match(component,/version!==generation\.current\|\|controller\.signal\.aborted/,
  "Stale aborted OCR must never replace the next attempt's source-bound frames");
 assert.match(component,/pixelReviewSha256&&f\.visualReviewSha256/,
  "Auto OCR must not bypass clinician review");
});
