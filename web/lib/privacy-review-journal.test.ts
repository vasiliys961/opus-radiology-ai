import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { appendPrivacyEvent,buildPrivacyReviewBundle,createPrivacyJournal,exportPrivacyJournal,MAX_PRIVACY_EVENTS,
  MAX_PRIVACY_BUNDLE_BYTES,restorePrivacyReviewBundle,type PrivacyAction,type PrivacyJournal } from "./privacy-review-journal.ts";
import { validatePrivacyRaster } from "./vision-privacy-browser.ts";
import { assessPrivacyReadiness,buildPrivacyReadinessReport } from "./privacy-readiness.ts";
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

test("restore retains exact redacted pixels/history but revokes imported human checks and OCR",()=>{
  const original=frame(),changed=createPrivacyFrame(png(0),"frame-1","CT",[rect]);
  let j=add(start(),original,{kind:"redacted",nextSha256:changed.sha256,rectangles:[rect]});
  j=add(j,changed,{kind:"ocr-started"});j=add(j,changed,{kind:"ocr-completed",regionCount:2});
  j=add(j,changed,{kind:"text-retained"});const reviewed=review(j,changed),bundle=buildPrivacyReviewBundle([reviewed.f],reviewed.j,id);
  const restored=restorePrivacyReviewBundle(JSON.stringify(bundle),[original],null,at);
  assert.equal(restored.frames[0].pngBase64,changed.pngBase64);assert.deepEqual(restored.frames[0].redactions,[rect]);
  assert.equal(restored.frames[0].pixelReviewSha256,null);assert.equal(restored.frames[0].visualReviewSha256,null);
  assert.deepEqual(restored.journal.events.slice(0,-1),reviewed.j.events);
  assert.equal(restored.journal.events.at(-1)?.action.kind,"copy-restored");assert.equal(restored.journal.schema,"opus-privacy-journal/v2");
  assert.throws(()=>buildPrivacyReviewBundle(restored.frames,restored.journal,id),/Проверьте/);
  assert.throws(()=>add(restored.journal,restored.frames[0],{kind:"text-retained"}),/Нет найденных/);
  const rechecked=review(restored.journal,restored.frames[0]),v2=buildPrivacyReviewBundle([rechecked.f],rechecked.j,id);
  assert.equal(v2.schema,"opus-vision-privacy-review/v2");assert.equal(v2.review.schema,"opus-privacy-journal-export/v2");
  assert.equal(restorePrivacyReviewBundle(JSON.stringify(v2),[original],null,at).frames[0].pixelReviewSha256,null);
});

test("restore only extends a nonempty current prefix; older, forked and other-session files cannot erase it",()=>{
  const base=review(start(),frame()),saved=buildPrivacyReviewBundle([base.f],base.j,id);
  let extension=add(base.j,base.f,{kind:"review-set",review:"pixel",checked:false});
  extension=add(extension,base.f,{kind:"review-set",review:"pixel",checked:true});
  const extended=buildPrivacyReviewBundle([base.f],extension,id);
  const current={journal:base.j,frames:[base.f]};
  const restored=restorePrivacyReviewBundle(JSON.stringify(extended),[frame()],current,at);
  assert.deepEqual(restored.journal.events.slice(0,base.j.events.length),base.j.events);
  assert.throws(()=>restorePrivacyReviewBundle(JSON.stringify(saved),[frame()],{journal:extension,frames:[base.f]},at),/старее/);
  const fork={...base.j,events:base.j.events.map(e=>({...e,declaredAt:"2026-10-12T14:01:00.000Z"}))};
  const foreign={...base.j,sessionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"};
  for(const j of [fork,foreign])assert.throws(()=>restorePrivacyReviewBundle(JSON.stringify(buildPrivacyReviewBundle([base.f],j,id)),[frame()],current,at),/другую ветку/);
  assert.equal(current.journal.events.length,2);assert.equal(current.frames[0].pixelReviewSha256,base.f.sha256);
});

test("restore checks initial raster, modality, frame order and actual current state before replacement",()=>{
  const a=frame(),b=frame("frame-2");let j=start([a,b]);const first=review(j,a);j=first.j;
  const second=review(j,b);j=second.j;const bundle=JSON.stringify(buildPrivacyReviewBundle([first.f,second.f],j,id));
  for(const originals of [[createPrivacyFrame(png(0),"frame-1","CT"),b],[{...a,modality:"MR" as const},b],[b,a],[a]])
    assert.throws(()=>restorePrivacyReviewBundle(bundle,originals,null,at),/другим выбранным/);
  assert.throws(()=>restorePrivacyReviewBundle(bundle,[a,b],{journal:j,frames:[{...first.f,visualReviewSha256:null},second.f]},at),/повреждён/);
});

test("restore refuses forged flags, digest/pixel/history changes and incompatible wrappers",()=>{
  const {j,f}=review(start(),frame()),bundle=buildPrivacyReviewBundle([f],j,id);
  const mutations=[(b:typeof bundle)=>{b.review.journalSha256="f".repeat(64);},
    (b:typeof bundle)=>{b.candidate.frames[0].pngBase64=Buffer.from(png(0)).toString("base64");},
    (b:typeof bundle)=>{b.review.journal.events[0].revision=4;},
    (b:typeof bundle)=>{b.candidate.transmissionPermitted=true as false;},
    (b:typeof bundle)=>{b.candidate.deidentificationVerified=true as false;},
    (b:typeof bundle)=>{b.schema="opus-vision-privacy-review/v2";},
    (b:typeof bundle)=>{b.review.journal.actor="verified" as "local-unverified";}];
  for(const mutate of mutations){const copy=structuredClone(bundle);mutate(copy);assert.throws(()=>restorePrivacyReviewBundle(JSON.stringify(copy),[frame()],null,at));}
  for(const input of [bundle.candidate,bundle.review,null,[]])assert.throws(()=>restorePrivacyReviewBundle(JSON.stringify(input),[frame()],null,at));
});

test("restore bounds parse/history, reserves all frame reset entries and never exposes parse fragments",()=>{
  assert.throws(()=>restorePrivacyReviewBundle(" ".repeat(MAX_PRIVACY_BUNDLE_BYTES+1),[frame()],null,at),/12 МиБ/);
  assert.throws(()=>restorePrivacyReviewBundle('{"SYNTHETIC-SECRET":oops}',[frame()],null,at),e=>e instanceof Error&&!e.message.includes("SYNTHETIC-SECRET"));
  let {j,f}=review(start(),frame());
  while(j.events.length<MAX_PRIVACY_EVENTS)j=add(j,f,{kind:"review-set",review:"pixel",checked:true});
  for(const count of [126,127,128]){
    const bundle=buildPrivacyReviewBundle([f],{...j,events:j.events.slice(0,count)},id);
    assert.throws(()=>restorePrivacyReviewBundle(JSON.stringify(bundle),[frame()],null,at),/нет места/);
  }
  const accepted=restorePrivacyReviewBundle(JSON.stringify(buildPrivacyReviewBundle([f],{...j,events:j.events.slice(0,125)},id)),[frame()],null,at);
  const rechecked=review(accepted.journal,accepted.frames[0]);
  assert.equal(buildPrivacyReviewBundle([rechecked.f],rechecked.j,id).review.journal.events.length,128);
  assert.equal(j.events.length,128);assert.equal(f.pixelReviewSha256,f.sha256);
});

test("unknown file fields are discarded; old v1 clients cannot replay restored v2 events as v1",()=>{
  const {j,f}=review(start(),frame()),bundle=buildPrivacyReviewBundle([f],j,id);
  const raw=JSON.parse(JSON.stringify(bundle));raw.patientName="SYNTHETIC-SECRET";raw.candidate.frames[0].token="SYNTHETIC-SECRET";
  raw.review.journal.events[0].action.text="SYNTHETIC-SECRET";
  const restored=restorePrivacyReviewBundle(JSON.stringify(raw),[frame()],null,at);
  assert.doesNotMatch(JSON.stringify(restored),/SYNTHETIC-SECRET|patientName|token|text"/);
  assert.throws(()=>exportPrivacyJournal({...restored.journal,schema:"opus-privacy-journal/v1"},restored.frames),/версии v2/);
});

test("imported raster verification checks bounds/hash before decoder allocation and clears decoder on all exits",async()=>{
  const previous=globalThis.Image;let allocated=0,lastSrc="",fail=false;
  class Decoder {naturalWidth=1;naturalHeight=1;constructor(){allocated++;}set src(v:string){lastSrc=v;}
    decode(){return fail?Promise.reject(new Error("SYNTHETIC-SECRET")):Promise.resolve();}}
  globalThis.Image=Decoder as unknown as typeof Image;
  try{
    const signal=new AbortController().signal,f=frame();
    await assert.rejects(validatePrivacyRaster({...f,sha256:"f".repeat(64)},signal),/SHA/);assert.equal(allocated,0);
    await validatePrivacyRaster(f,signal);assert.equal(lastSrc,"");
    fail=true;await assert.rejects(validatePrivacyRaster(f,signal),/Пиксели копии не читаются/);assert.equal(lastSrc,"");
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(validatePrivacyRaster(f,cancelled.signal),/отменено/);
    assert.equal(allocated,2);
  }finally{globalThis.Image=previous;}
});

test("cancelling a pending imported decoder cleans it without waiting for its decode promise",async()=>{
  const previous=globalThis.Image;let lastSrc="";
  class Decoder {set src(v:string){lastSrc=v;}decode(){return new Promise<void>(()=>{});}}
  globalThis.Image=Decoder as unknown as typeof Image;
  try{const controller=new AbortController(),pending=validatePrivacyRaster(frame(),controller.signal);controller.abort();
    await assert.rejects(pending,/отменено/);assert.equal(lastSrc,"");
  }finally{globalThis.Image=previous;}
});

test("local readiness counts exact per-frame human marks but never releases Cloud",()=>{
  const first=review(start(),frame()),other=frame("frame-2");
  const assessment=assessPrivacyReadiness({frames:[first.f,other],ocr:{},keptText:{},busy:false});
  assert.equal(assessment.status,"needs-local-review");assert.deepEqual(assessment.frames.map(f=>f.localReviewDone),[true,false]);
  const ready=assessPrivacyReadiness({frames:[first.f],ocr:{},keptText:{},busy:false});
  assert.equal(ready.localReviewDone,true);assert.equal(ready.transmissionPermitted,false);assert.equal(ready.deidentificationVerified,false);
  assert.equal(ready.serverChecks.length,7);assert.ok(ready.serverChecks.every(c=>c.status==="not-connected"));
  assert.equal(ready.productionRelease,"not-implemented");
  assert.equal(assessPrivacyReadiness({frames:[],ocr:{},keptText:{},busy:false}).status,"not-prepared");
  assert.equal(assessPrivacyReadiness({frames:[first.f],ocr:{},keptText:{},busy:true}).localReviewDone,false);
});
test("OCR absence/zero/stale are distinct, never auto-mark reviews; positive detections need exact-copy acknowledgement",()=>{
  const f=frame(),input={frames:[f],keptText:{},busy:false};
  const positive={sha256:f.sha256,regions:[{rectangle:rect,confidence:99}]};
  assert.equal(assessPrivacyReadiness({...input,ocr:{}}).frames[0].ocrState,"not-run");
  const zero=assessPrivacyReadiness({...input,ocr:{[f.frameId]:{sha256:f.sha256,regions:[]}}});
  assert.equal(zero.frames[0].ocrState,"no-text-found");assert.equal(zero.localReviewDone,false);
  const stale=assessPrivacyReadiness({...input,ocr:{[f.frameId]:{...positive,sha256:"f".repeat(64)}}});
  assert.equal(stale.frames[0].ocrState,"stale");assert.equal(stale.frames[0].regionCount,null);
  const both=review(start(),f).f;
  const unresolved=assessPrivacyReadiness({...input,frames:[both],ocr:{[f.frameId]:positive},keptText:{[f.frameId]:"f".repeat(64)}});
  assert.equal(unresolved.localReviewDone,false);
  assert.equal(assessPrivacyReadiness({...input,frames:[both],ocr:{[f.frameId]:positive},keptText:{[f.frameId]:f.sha256}}).localReviewDone,true);
});
test("rendering local readiness never reads PNG or opaque PHI/word/secret fields",()=>{
  const f=frame(),ocr={sha256:f.sha256,regions:[{rectangle:rect,confidence:99}]};
  Object.defineProperty(f,"pngBase64",{get(){throw new Error("Rendering must not decode pixels");}});
  for(const object of [f,ocr])for(const key of ["text","token","patientName","opaqueDicom"])
    Object.defineProperty(object,key,{enumerable:true,get(){throw new Error("Must not read opaque field");}});
  const raw=JSON.stringify(assessPrivacyReadiness({frames:[f],ocr:{[f.frameId]:ocr},keptText:{},busy:false}));
  assert.doesNotMatch(raw,/pngBase64|text"|token|patientName|opaqueDicom|confidence/);
});
test("readiness export checks actual raster/current journal while allowing incomplete local drafts",()=>{
  const f=frame(),j=start(),input={frames:[f],ocr:{},keptText:{},busy:false};
  const report=buildPrivacyReadinessReport(input,j);
  assert.equal(report.validation,"local-copy-sha-and-journal-checked");assert.equal(report.journalRevision,0);
  assert.equal(report.localReviewDone,false);assert.doesNotMatch(JSON.stringify(report),/pngBase64|initialFrames|events"/);
  assert.throws(()=>buildPrivacyReadinessReport({...input,busy:true},j),/завершите/);
  assert.throws(()=>buildPrivacyReadinessReport({...input,frames:[{...f,pngBase64:Buffer.from(png(0)).toString("base64")}]},j),/не совпадают/);
  assert.throws(()=>buildPrivacyReadinessReport({...input,frames:[markPrivacyReview(f,"pixel",true)]},j),/не совпадают/);
  const checked=review(j,f);assert.equal(buildPrivacyReadinessReport({...input,frames:[checked.f]},checked.j).localReviewDone,true);
});
test("changed or restored copies revoke readiness and invalid metadata cannot be rendered as checked",()=>{
  const checked=review(start(),frame()),newFrame=createPrivacyFrame(png(0),"frame-1","CT",[rect]);
  const input={frames:[newFrame],ocr:{},keptText:{},busy:false};
  assert.equal(assessPrivacyReadiness(input).localReviewDone,false);
  const restored=restorePrivacyReviewBundle(JSON.stringify(buildPrivacyReviewBundle([checked.f],checked.j,id)),[frame()],null,at);
  assert.equal(buildPrivacyReadinessReport({...input,frames:restored.frames},restored.journal).localReviewDone,false);
  for(const frames of [[frame(),frame()],Array(5).fill(frame()),[{...frame(),width:Infinity}],[{...frame(),frameId:"patient-filename"}]])
    assert.throws(()=>assessPrivacyReadiness({...input,frames}));
});
