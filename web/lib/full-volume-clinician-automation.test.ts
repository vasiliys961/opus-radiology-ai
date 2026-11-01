import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {createPrivacyFrame} from "./vision-privacy.ts";
import {normalizeAutoPublicVolumePacket} from "./auto-volume-research-packet.ts";
import {reviewApprovedVolumeGeminiBatch} from "./approved-volume-batch-review.ts";
import {planBudgetedVisionReview} from "./vision-budget-plan.ts";
import {createVisionBatches} from "./vision-batch-ledger.ts";
import {appendGeminiVolumeReceipt,makeSafeVolumeOpusInput,volumeLedger,
 canPayForNextBatch} from "./full-volume-receipts.ts";
import {validateSafeFullVolumeOpusInput,synthesizeSafeFullVolumeOpus}
 from "./full-volume-opus-synthesis.ts";
import {TASKS_BY_REGION,type SanitizedDetectorBundle} from "./detector-consilium-evidence.ts";
import type {VolumeGeminiBatchResult} from "./approved-volume-batch-review.ts";
function chunk(type:string,payload:Buffer){
 const tag=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);
 len.writeUInt32BE(payload.length);let c=0xffffffff;
 for(const b of Buffer.concat([tag,payload])){c^=b;
   for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
 crc.writeUInt32BE((c^0xffffffff)>>>0);
 return Buffer.concat([len,tag,payload,crc]);
}
function png(){
 const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);
 h[8]=8;h[9]=6;
 const raw=Buffer.from([0,1,2,3,255,4,5,6,255,0,7,8,9,255,10,11,12,255]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk("IHDR",h),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}
function publicPacket(){
 const f=createPrivacyFrame(png(),"frame-1","CT");
 return {schema:"opus-public-volume-auto-ocr/v1" as const,modality:"CT" as const,
  frames:[{frameId:"frame-1",pngBase64:f.pngBase64,sha256:f.sha256,
    ocrSha256:f.sha256,ocrClear:true as const}]};
}
function geminiAnswer(count:number):VolumeGeminiBatchResult{
 return {schema:"opus-gemini-volume-batch/v1",model:"google/gemini-3.8-flash",
  modality:"CT",imagesReviewed:count,
  reviewedImageIds:Array.from({length:count},(_,i)=>"frame-"+(i+1)),
  observations:[{id:"f1",imageId:"frame-1",anatomy:"synthetic chest",
    sign:"synthetic observation",uncertainty:"not a patient"}],
  limitations:["Image observation is research-only"],
  receipt:{inputTokens:560,outputTokens:70},clinicalValidation:false,
  sourceBindingsLocalOnly:true};
}
const detectors:SanitizedDetectorBundle={
 schema:"opus-sanitized-detector-consilium/v1",region:"chest",modality:"CT",
 sourceIdentifiersSent:false,sourcePixelsSent:false,
 clinicalValidation:false,negativeDiagnosisPermitted:false,
 facts:TASKS_BY_REGION.chest.map((task,i)=>({
  task,status:i===1?"completed":"not_assessed",
  candidateCount:i===1?2:null,candidateVolumeMl:i===1?2.2:null,
 })),
};
const report=[
 "ИССЛЕДОВАНИЕ: Исследовательская компьютерная томография грудной клетки.",
 "МЕТОДИКА: Все срезы одного выбранного ряда оценены системой Gemini. Claude Opus анализировал только структурированные наблюдения.",
 "ОПИСАНИЕ: В представленных наблюдениях описаны отдельные неоднозначные изменения; надёжность визуальной трактовки не подтверждена.",
 "ЗАКЛЮЧЕНИЕ: Предварительные данные исследовательской модели, требующие проверки на исходных изображениях.",
 "РЕКОМЕНДАЦИИ: Врачебная оценка всего набора исходных DICOM и уточнение находок.",
].join("\n");
test("Automatic public PNG batch is exact hash-bound, not misrepresented as human-reviewed",async()=>{
 const packet=publicPacket();
 const normalized=normalizeAutoPublicVolumePacket(packet);
 assert.equal(normalized.frames.length,1);
 assert.equal(normalized.modality,"CT");
 let calls=0;
 const result=await reviewApprovedVolumeGeminiBatch(packet,async req=>{
  calls++;
  assert.equal(req.role,"vision");
  const s=JSON.stringify(req.messages);
  assert.equal(s.includes("SOPInstanceUID"),false);
  return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
   role:"observations",reviewedImageIds:["frame-1"],
   observations:[{id:"f1",imageId:"frame-1",anatomy:"synthetic chest",
    sign:"synthetic object",uncertainty:"nonclinical"}],
   limitations:["Sliced fixture"]})}}],
   usage:{prompt_tokens:300,completion_tokens:80}};
 },undefined,"auto-ocr-public-study");
 assert.equal(calls,1);assert.equal(result.imagesReviewed,1);
 for(const tampered of [
  {...packet,frames:[{...packet.frames[0],ocrClear:false}]},
  {...packet,frames:[{...packet.frames[0],ocrSha256:"f".repeat(64)}]},
  {...packet,frames:[{...packet.frames[0],frameId:"SOPInstanceUID"}]},
  {...packet,patientName:"synthetic"},
 ]){
  assert.throws(()=>normalizeAutoPublicVolumePacket(tampered));
 }
});
test("103 native CT images produce 26 ordered Gemini receipts and a single Opus detector-aware report",async()=>{
 const plan=planBudgetedVisionReview({frameCount:103,maxGeminiUSD:0.50});
 const batches=createVisionBatches(plan,4);
 let receipts:ReturnType<typeof appendGeminiVolumeReceipt>=[];
 for(const [i,b] of batches.entries()){
  assert.ok(canPayForNextBatch(plan,batches,receipts));
  receipts=appendGeminiVolumeReceipt(receipts,batches,i,geminiAnswer(b.indices.length));
 }
 const ledger=volumeLedger(plan,batches,receipts);
 assert.equal(ledger.processedOverviewFrames,103);
 assert.equal(ledger.completedFullOverview,true);
 const safe=makeSafeVolumeOpusInput("CT",plan,batches,receipts,detectors,"completed");
 assert.equal(safe.detectorEvidence?.facts[1].candidateCount,2);
 assert.equal(safe.observations.length,26);
 assert.ok(validateSafeFullVolumeOpusInput(safe));
 let count=0;
 const result=await synthesizeSafeFullVolumeOpus(safe,async req=>{
  count++;assert.equal(req.model,"anthropic/claude-opus-5.5");
  assert.equal(req.role,"reasoning");
  assert.match(JSON.stringify(req.messages),/lung_tumor/);
  return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
   summary:report,limitations:["Research-only, no clinical validation"],
  })}}],usage:{prompt_tokens:4800,completion_tokens:800}};
 });
 assert.equal(count,1);
 assert.equal(result.overviewReviewed,103);
 assert.equal(result.physicianSignatureRequired,true);
 assert.match(result.finalReport,/ЗАКЛЮЧЕНИЕ:/);
 assert.throws(()=>makeSafeVolumeOpusInput("CT",plan,batches,receipts.slice(0,-1),detectors),
  /complete/i);
});
