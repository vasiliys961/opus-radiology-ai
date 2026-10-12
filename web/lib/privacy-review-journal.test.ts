import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { appendPrivacyEvent,buildPrivacyReviewBundle,createPrivacyJournal,exportPrivacyJournal,MAX_PRIVACY_EVENTS,
  type PrivacyAction,type PrivacyJournal } from "./privacy-review-journal.ts";
import { createPrivacyFrame,markPrivacyReview,type PrivacyFrame } from "./vision-privacy.ts";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",at="2026-10-12T14:00:00.000Z",rect={x:0,y:0,width:1,height:1};
function png(value=255){
  function chunk(type:string,payload:Buffer){
    const tag=Buffer.from(type),length=Buffer.alloc(4),check=Buffer.alloc(4);length.writeUInt32BE(payload.length);
    let crc=0xffffffff;for(const b of Buffer.concat([tag,payload])){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    check.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,tag,payload,check]);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),
    chunk("IDAT",deflateSync(Buffer.from([0,value,value,value,255]))),chunk("IEND",Buffer.alloc(0))]);
}
const frame=(name="frame-1")=>createPrivacyFrame(png(),name,"CT");
const start=(frames:PrivacyFrame[]=[frame()])=>createPrivacyJournal(frames,id,at);
const add=(j:PrivacyJournal,f:PrivacyFrame,action:PrivacyAction)=>appendPrivacyEvent(j,f.frameId,f.sha256,action,at);
function review(j:PrivacyJournal,f:PrivacyFrame){
  for(const kind of ["pixel","visual"] as const){j=add(j,f,{kind:"review-set",review:kind,checked:true});f=markPrivacyReview(f,kind,true);}
  return {j,f};
}

test("review bundle binds current raster to immutable ordered local declarations and digest",()=>{
  const original=start(),{j,f}=review(original,frame()),bundle=buildPrivacyReviewBundle([f],j,id);
  assert.equal(original.events.length,0);assert.deepEqual(j.events.map(e=>e.revision),[1,2]);
  assert.equal(bundle.review.journalSha256,createHash("sha256").update(JSON.stringify(bundle.review.journal)).digest("hex"));
  assert.equal(bundle.candidate.frames[0].sha256,j.initialFrames[0].sha256);
  assert.equal(bundle.candidate.transmissionPermitted,false);assert.equal(bundle.candidate.deidentificationVerified,false);
  assert.equal(bundle.review.transmissionPermitted,false);assert.equal(bundle.review.journal.actor,"local-unverified");
});

test("redaction records old/new hashes, resets review and rejects stale completion or unrecorded edits",()=>{
  let {j,f}=review(start(),frame());const before=j;
  const changed=createPrivacyFrame(png(0),f.frameId,f.modality,[rect]);
  j=add(j,f,{kind:"redacted",nextSha256:changed.sha256,rectangles:[rect]});
  assert.equal(before.events.length,2);assert.equal(j.events[2].sha256,f.sha256);
  assert.equal(exportPrivacyJournal(j,[changed]).journal.events.length,3);
  assert.throws(()=>exportPrivacyJournal(j,[f]),/не совпадают/);
  assert.throws(()=>exportPrivacyJournal(j,[{...changed,pixelReviewSha256:changed.sha256}]),/не совпадают/);
  assert.throws(()=>add(j,f,{kind:"ocr-started"}),/История/);
  assert.throws(()=>buildPrivacyReviewBundle([changed],j,id),/Проверьте/);
  ({j,f}=review(j,changed));assert.equal(buildPrivacyReviewBundle([f],j,id).candidate.frames[0].redactions.length,1);
});

test("positive OCR needs explicit local acknowledgement; rescan revokes checks and acknowledgement",()=>{
  let f=frame(),j=add(start(),f,{kind:"ocr-started"});
  assert.throws(()=>exportPrivacyJournal(j,[f]),/завершите/);
  assert.throws(()=>add(j,f,{kind:"review-set",review:"pixel",checked:true}),/завершения/);
  j=add(j,f,{kind:"ocr-completed",regionCount:2});
  assert.throws(()=>add(j,f,{kind:"review-set",review:"pixel",checked:true}),/Сначала/);
  j=add(j,f,{kind:"text-retained"});({j,f}=review(j,f));
  j=add(j,f,{kind:"ocr-started"});j=add(j,f,{kind:"ocr-completed",regionCount:2});
  assert.throws(()=>exportPrivacyJournal(j,[f]),/не совпадают/);
  assert.throws(()=>add(j,f,{kind:"review-set",review:"pixel",checked:true}),/Сначала/);
});

test("empty, failed and cancelled OCR do not certify privacy or set human checks",()=>{
  for(const action of [{kind:"ocr-completed",regionCount:0},{kind:"ocr-cancelled"},{kind:"ocr-failed"}] as PrivacyAction[]){
    const f=frame();let j=add(start(),f,{kind:"ocr-started"});j=add(j,f,action);
    assert.equal(exportPrivacyJournal(j,[f]).status,"local-unverified");
    assert.throws(()=>buildPrivacyReviewBundle([f],j,id),/Проверьте/);
    assert.throws(()=>add(j,f,{kind:"text-retained"}),/Нет найденных/);
  }
});

test("journal cap never truncates entries and reserves space for OCR terminal event",()=>{
  const f=frame();let j=start();
  for(let i=0;i<MAX_PRIVACY_EVENTS-2;i++)j=add(j,f,{kind:"review-set",review:"pixel",checked:false});
  j=add(j,f,{kind:"ocr-started"});assert.equal(j.events.length,127);
  j=add(j,f,{kind:"ocr-cancelled"});assert.equal(j.events.length,128);
  assert.throws(()=>add(j,f,{kind:"ocr-started"}),/Лимит/);
  assert.throws(()=>add(j,f,{kind:"review-set",review:"pixel",checked:false}),/Лимит/);
  assert.equal(exportPrivacyJournal(j,[f]).journal.events.length,128);
  assert.throws(()=>add({...j,events:j.events.slice(0,-1)},f,{kind:"ocr-started"}),/Лимит/);
});

test("malformed/reordered/foreign declarations and concurrent frame OCR are refused",()=>{
  const f=frame(),other=frame("frame-2");let j=start([f,other]);
  assert.throws(()=>appendPrivacyEvent(j,"frame-3",f.sha256,{kind:"ocr-started"},at),/История/);
  j=add(j,f,{kind:"ocr-started"});assert.throws(()=>add(j,other,{kind:"ocr-started"}),/текущего кадра/);
  for(const action of [{kind:"ocr-completed",regionCount:65},{kind:"ocr-completed",regionCount:-1},
    {kind:"ocr-completed",regionCount:1.5}] as PrivacyAction[])assert.throws(()=>add(j,f,action),/Неверный результат/);
  const completed=add(j,f,{kind:"ocr-completed",regionCount:0});
  assert.throws(()=>exportPrivacyJournal({...completed,events:[completed.events[1],completed.events[0]]},[f,other]),/История/);
  assert.throws(()=>exportPrivacyJournal({...completed,events:completed.events.map(e=>({...e,sha256:"f".repeat(64)}))},[f,other]),/История/);
  assert.throws(()=>exportPrivacyJournal({...completed,actor:"verified"} as unknown as PrivacyJournal,[f,other]));
  assert.throws(()=>exportPrivacyJournal({...completed,createdAt:"bad"},[f,other]));
});

test("journal exports strip opaque fields without reading PHI, words, tokens or pixels into history",()=>{
  const f=frame();let j=start();
  const action:PrivacyAction={kind:"ocr-started"};
  for(const object of [f,j,j.initialFrames[0],action])for(const key of ["patientName","text","token","opaqueDicom"])
    Object.defineProperty(object,key,{enumerable:true,get(){throw new Error("Do not read sensitive field");}});
  j=add(j,f,action);j=add(j,f,{kind:"ocr-failed"});
  const raw=JSON.stringify(exportPrivacyJournal(j,[f]));
  assert.doesNotMatch(raw,/patientName|text"|token|opaqueDicom|pngBase64/);
  const bad={...frame(),pngBase64:Buffer.from(png(0)).toString("base64")};
  assert.throws(()=>exportPrivacyJournal(j,[bad]),/не совпадают/);
});

test("new preparation has independent session history; checked/redacted initial copies are refused",()=>{
  const {j,f}=review(start(),frame()),fresh=createPrivacyJournal([frame()],"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",at);
  assert.equal(fresh.events.length,0);assert.notEqual(fresh.sessionId,j.sessionId);
  assert.throws(()=>exportPrivacyJournal(fresh,[f]),/не совпадают/);
  assert.throws(()=>createPrivacyJournal([f],id,at),/непроверенных/);
  assert.throws(()=>createPrivacyJournal([createPrivacyFrame(png(0),"frame-1","CT",[rect])],id,at),/непроверенных/);
  for(const frames of [[],[frame(),frame()],Array(5).fill(frame())])assert.throws(()=>createPrivacyJournal(frames,id,at));
});

test("invalid redactions and fabricated terminal/review actions cannot enter the journal",()=>{
  const f=frame(),j=start();
  for(const action of [{kind:"redacted",nextSha256:"x",rectangles:[rect]},
    {kind:"redacted",nextSha256:f.sha256,rectangles:[{...rect,width:2}]},
    {kind:"redacted",nextSha256:f.sha256,rectangles:[]},
    {kind:"redacted",nextSha256:f.sha256,rectangles:Array(33).fill(rect)},
    {kind:"review-set",review:"patientName",checked:true},{kind:"review-set",review:"pixel",checked:"yes"},
    {kind:"ocr-completed",regionCount:0},{kind:"ocr-cancelled"},{kind:"unknown"}] as unknown as PrivacyAction[])
    assert.throws(()=>add(j,f,action));
  assert.throws(()=>appendPrivacyEvent(j,f.frameId,f.sha256,{kind:"ocr-started"},"not-a-date"));
});
