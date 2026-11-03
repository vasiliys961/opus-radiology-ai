import {reviewPreparedStudy} from './review-prepared-study.ts';
import {createPrivacyJournal,appendPrivacyEvent,exportPrivacyJournal} from './privacy-review-journal.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createPrivacyFrame,markPrivacyReview,buildVisionPrivacyPacket} from './vision-privacy.ts';
import {selectTargetedVisualInput,reviewTargetedOpus} from './opus-targeted-visual-review.ts';
import {synthesizeSafeFullVolumeOpus,validateSafeFullVolumeOpusInput} from './full-volume-opus-synthesis.ts';
import type {LocalVolumeReceipt,SafeVolumeOpusInput} from './full-volume-receipts.ts';
function chunk(type:string,payload:Buffer){
 const tag=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);
 len.writeUInt32BE(payload.length);let c=0xffffffff;
 for(const b of Buffer.concat([tag,payload])){c^=b;
   for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
 crc.writeUInt32BE((c^0xffffffff)>>>0);
 return Buffer.concat([len,tag,payload,crc]);
}
function png(seed=1){
 const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);
 h[8]=8;h[9]=6;
 const raw=Buffer.from([0,1,2,3,255,4,5,6,255,0,7,8,9,255,10,11,12,255]);
 raw[1]=seed;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk("IHDR",h),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}

function packet(seed=1){return buildVisionPrivacyPacket([markPrivacyReview(markPrivacyReview(createPrivacyFrame(png(seed),'frame-1','CT'),'pixel',true),'visual',true)],crypto.randomUUID());}
const safe:SafeVolumeOpusInput={schema:'opus-volume-synthesis-request/v1',modality:'CT',plannedFrames:1,overviewReviewed:1,targetedReviewed:0,
 completedBatches:1,totalBatches:1,observations:[{sliceNumber:1,pass:'overview',anatomy:'chest',sign:'GEMINI_ONLY_MARKER',uncertainty:'uncertain'}],
 limitations:[],detectorState:'unavailable',detectorEvidence:null,acknowledgePaidOpusSynthesis:true};
const report=[
 "ИССЛЕДОВАНИЕ: Исследовательская компьютерная томография грудной клетки.",
 "МЕТОДИКА: Все срезы одного выбранного ряда оценены системой Gemini. Claude Opus анализировал только структурированные наблюдения.",
 "ОПИСАНИЕ: В представленных наблюдениях описаны отдельные неоднозначные изменения; надёжность визуальной трактовки не подтверждена.",
 "ЗАКЛЮЧЕНИЕ: Предварительные данные исследовательской модели, требующие проверки на исходных изображениях.",
 "РЕКОМЕНДАЦИИ: Врачебная оценка всего набора исходных DICOM и уточнение находок.",
].join("\n");
const response=(content:unknown)=>({choices:[{message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:20}});
const blind={role:'observations',reviewedImageIds:['frame-1'],observations:[{id:'o1',imageId:'frame-1',anatomy:'chest',sign:'OPUS_BLIND_MARKER',uncertainty:'not diagnostic'}],limitations:['sample only']};
test('partial/noncontiguous selection keeps true original numbers; unreviewed slice cannot enter Opus',async()=>{
 const partial={...safe,sourceTotalFrames:150,sourceSliceNumbers:[150],observations:safe.observations.map(o=>({...o,sliceNumber:150}))};
 assert.equal(validateSafeFullVolumeOpusInput(partial),true);
 assert.equal(validateSafeFullVolumeOpusInput({...partial,sourceSliceNumbers:[151]}),false);
 assert.equal(validateSafeFullVolumeOpusInput({...partial,observations:partial.observations.map(o=>({...o,sliceNumber:1}))}),false);
 const selected=selectTargetedVisualInput([packet()],[{recheckIndices:[149]} as LocalVolumeReceipt],[],[149])!;
 assert.deepEqual(selected.sliceNumbers,[150]);
 let calls=0;
 await assert.rejects(()=>synthesizeSafeFullVolumeOpus({synthesis:partial,visualReview:{...selected,sliceNumbers:[1]}},async()=>{calls++;return response(blind);}));
 assert.equal(calls,0);
 const result=await synthesizeSafeFullVolumeOpus(partial,async()=>response({summary:report,limitations:['partial']}));
 assert.match(result.finalReport,/1 из 150/);assert.match(result.finalReport,/Оценены: 150/);
});
test('blind visual Opus sees reviewed pixels and ordinals, no Gemini claims; synthesis sees both separately',async()=>{
 let n=0;
 const visual={packets:[packet()],sliceNumbers:[1]};
 const result=await synthesizeSafeFullVolumeOpus({synthesis:safe,visualReview:visual},async req=>{
  n++;const text=JSON.stringify(req.messages);
  // Both independent reading and reconciliation must preserve missing facts;
  // these assertions check request wiring, not clinical compliance of a model.
  assert.match(text,/Unknown contrast stays unknown/);
  assert.match(text,/Patient orientation is not provided/);
  assert.match(text,/separate physician-review paragraph/);
  if(n===2)assert.match(text,/a reader's claim about patient side or contrast is NOT verified technical metadata/);
  if(n===1){assert.ok(text.includes('data:image/png;base64,'));assert.ok(!text.includes('GEMINI_ONLY_MARKER'));return response(blind);}
  assert.ok(text.includes('GEMINI_ONLY_MARKER'));assert.ok(text.includes('OPUS_BLIND_MARKER'));
  assert.ok(!text.includes('data:image/png;base64,'));return response({summary:report,limitations:['sample only']});
 });
 assert.equal(n,2);assert.equal(result.visualReview?.status,'completed');
 assert.match(result.finalReport,/Opus визуально просмотрел срезы: 1/);
 assert.match(result.finalReport,/Остальные срезы Opus не просматривал/);
 assert.match(result.finalReport,/Сравнение с предыдущим исследованием не выполнено/);
 if(result.visualReview?.status==='completed')assert.equal(result.visualReview.observations[0].sliceNumber,1);
});
test('visual provider failure preserves final text synthesis with explicit unavailable state, never fake negatives',async()=>{
 let n=0;
 const result=await synthesizeSafeFullVolumeOpus({synthesis:safe,visualReview:{packets:[packet()],sliceNumbers:[1]}},async req=>{
  if(++n===1)throw Error('Provider unavailable');
  assert.match(JSON.stringify(req.messages),/unavailable/);return response({summary:report,limitations:['Visual unavailable']});
 });
 assert.equal(n,2);assert.equal(result.visualReview?.status,'unavailable');
});
test('invalid/mismatched visual binding is rejected before any paid model request',async()=>{
 let calls=0;const call=async()=>{calls++;return response(blind);};
 await assert.rejects(()=>reviewTargetedOpus({packets:[packet()],sliceNumbers:[2]},'CT',1,call));
 const altered=packet();altered.frames[0].pixelReviewSha256=null;
 await assert.rejects(()=>reviewTargetedOpus({packets:[altered],sliceNumbers:[1]},'CT',1,call));
 await assert.rejects(()=>synthesizeSafeFullVolumeOpus({synthesis:safe,visualReview:{packets:[packet()],sliceNumbers:[0]}},call));
 assert.equal(calls,0);
});
test('selection deduplicates source ordinals and retains exact approved pixels',()=>{
 const packets=[packet(10),packet(20),packet(30)];
 const receipts=[{findings:[{sourceIndex:2},{sourceIndex:2},{sourceIndex:0}],recheckIndices:[2,2,0]}] as unknown as LocalVolumeReceipt[];
 const selected=selectTargetedVisualInput(packets,receipts)!;
 assert.deepEqual(selected.sliceNumbers,[3,1,2]);
 assert.equal(selected.packets[0].frames[0].sha256,packets[2].frames[0].sha256);
 assert.equal(selected.packets[0].frames[0].pixelReviewSha256,packets[2].frames[0].sha256);
});

test('no focal/uncertain frame means no extra paid Opus request; description alone is not a trigger',()=>{
 assert.equal(selectTargetedVisualInput([packet()],[{findings:[{sourceIndex:0}],recheckIndices:[]} as unknown as LocalVolumeReceipt]),null);
 assert.equal(selectTargetedVisualInput([packet()],[{findings:[{sourceIndex:0}]} as unknown as LocalVolumeReceipt]),null);
});
test('all flagged slices are selected up to sixteen, no duplicates; larger set is capped',()=>{
 const packets=Array.from({length:20},()=>packet());
 const selected=selectTargetedVisualInput(packets,[{findings:[],recheckIndices:Array.from({length:20},(_,i)=>i)} as unknown as LocalVolumeReceipt])!;
 assert.equal(selected.sliceNumbers.length,16);assert.equal(selected.packets.length,4);
 assert.deepEqual(selected.sliceNumbers,Array.from({length:16},(_,i)=>i+1));
});
test('sixteen-image blind response is source-bound across packet boundaries',async()=>{
 const selected=selectTargetedVisualInput(Array.from({length:16},()=>packet()),[
  {findings:[],recheckIndices:Array.from({length:16},(_,i)=>i)} as unknown as LocalVolumeReceipt])!;
 const result=await reviewTargetedOpus(selected,'CT',16,async req=>{
  const text=JSON.stringify(req.messages);assert.match(text,/frame-16/);assert.ok(!text.includes('GEMINI_ONLY_MARKER'));
  return response({role:'observations',reviewedImageIds:Array.from({length:16},(_,i)=>'frame-'+(i+1)),
   observations:[{id:'last',imageId:'frame-16',anatomy:'synthetic',sign:'test',uncertainty:'not clinical'}],limitations:['selected only']});
 });
 assert.equal(result.observations[0].sliceNumber,16);assert.equal(result.sliceNumbers.length,16);
});

test('whole-study attestation resolves explicit OCR false positives with SHA-bound journal, never automatically',()=>{
 const frame=createPrivacyFrame(png(),'frame-1','CT');
 let journal=createPrivacyJournal([frame],crypto.randomUUID(),new Date().toISOString());
 journal=appendPrivacyEvent(journal,frame.frameId,frame.sha256,{kind:'ocr-started'},new Date().toISOString());
 journal=appendPrivacyEvent(journal,frame.frameId,frame.sha256,{kind:'ocr-completed',regionCount:1},new Date().toISOString());
 const groups=[{frames:[frame],journal,ocr:{'frame-1':{sha256:frame.sha256,regions:[{rectangle:{x:0,y:0,width:1,height:1},confidence:50}]}},unresolved:1,redacted:0}];
 assert.throws(()=>reviewPreparedStudy(groups,false));assert.equal(frame.pixelReviewSha256,null);
 const [result]=reviewPreparedStudy(groups,true);
 assert.ok(result.journal.events.some(e=>e.action.kind==='text-retained'));
 assert.doesNotThrow(()=>exportPrivacyJournal(result.journal,result.packet.frames));
 assert.equal(result.packet.frames[0].pixelReviewSha256,frame.sha256);
 const stale=[{...groups[0],ocr:{'frame-1':{sha256:'0'.repeat(64),regions:[]}}}];
 assert.throws(()=>reviewPreparedStudy(stale,true));
});
test('detector-localized source triggers blind review even when Gemini marks no focal frames; anchors excluded from blind prompt',async()=>{
 const packets=[packet(10),packet(20),packet(30),packet(40),packet(50)];
 const input=selectTargetedVisualInput(packets,[{findings:[],recheckIndices:[]} as unknown as LocalVolumeReceipt],
  [{candidateId:42,sourceIndex:3,xFraction:.4,yFraction:.6}])!;
 assert.equal(input.sliceNumbers[0],4);assert.equal(input.candidateAnchors?.[0].sliceNumber,4);
 assert.equal(input.packets[0].frames[0].sha256,packets[3].frames[0].sha256);
 const result=await reviewTargetedOpus(input,'CT',5,async req=>{
  const text=JSON.stringify(req.messages);assert.ok(!text.includes('candidateId'));assert.ok(!text.includes('lung_tumor'));
  const ids=input.sliceNumbers.map((_,i)=>'frame-'+(i+1));
  return response({role:'observations',reviewedImageIds:ids,observations:[],limitations:['sample only']});
 });
 assert.equal(result.status,'completed');
});
