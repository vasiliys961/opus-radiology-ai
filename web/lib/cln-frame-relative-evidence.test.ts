import test from "node:test";
import assert from "node:assert/strict";
import {createClnFrameRelativeEvidence,validateClnFrameRelativeEvidence}
 from "./cln-frame-relative-evidence.ts";
import {TASKS_BY_REGION} from "./detector-consilium-evidence.ts";
import {reviewSanitizedSamples,PILOT_GEMINI,PILOT_OPUS} from "./sanitized-cloud-review.ts";
import {createPrivacyFrame,markPrivacyReview,buildVisionPrivacyPacket}
 from "./vision-privacy.ts";
import {deflateSync} from "node:zlib";
const sha="a".repeat(64),ids=["frame-1","frame-2","frame-3","frame-4"];
const mapping={sourceImageSha256:sha,detectorSourceImageSha256:sha,
 imageDimensions:[256,256,120] as [number,number,number],
 reviewedFrames:ids.map((frameId,i)=>({frameId,sourceAxialIndex:46+i*2})),
 nativeCandidates:[{componentId:1,sourceVoxelCentroidIJK:[128,84,50] as [number,number,number],
  candidateVolumeMl:2.303572}]};
const bundle={schema:"opus-sanitized-detector-consilium/v1" as const,modality:"CT" as const,region:"chest" as const,
 facts:TASKS_BY_REGION.chest.map(task=>task==="lung_tumor"
 ?{task,status:"completed" as const,candidateCount:1,candidateVolumeMl:2.303572}
 :{task,status:"not_assessed" as const,candidateCount:null,candidateVolumeMl:null}),
 sourceIdentifiersSent:false as const,sourcePixelsSent:false as const,clinicalValidation:false as const,
 negativeDiagnosisPermitted:false as const};
function png(){
 const sig=Buffer.from([137,80,78,71,13,10,26,10]);
 const chunk=(t:string,b:Buffer)=>{
  const tag=Buffer.from(t),sz=Buffer.alloc(4),crc=Buffer.alloc(4);
  sz.writeUInt32BE(b.length);
  let s=0xffffffff;for(const x of Buffer.concat([tag,b])){s^=x;for(let i=0;i<8;i++)s=(s>>>1)^((s&1)?0xedb88320:0);}
  crc.writeUInt32BE((s^0xffffffff)>>>0);
  return Buffer.concat([sz,tag,b,crc]);
 };
 const hdr=Buffer.alloc(13);hdr.writeUInt32BE(2,0);hdr.writeUInt32BE(2,4);hdr[8]=8;hdr[9]=6;
 return Buffer.concat([sig,chunk("IHDR",hdr),chunk("IDAT",
  deflateSync(Buffer.from([0,1,2,3,255,4,5,6,255,0,7,8,9,255,10,11,12,255]))),chunk("IEND",Buffer.alloc(0))]);
}
const answer=(role:string,opus=false)=>({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
 role:"observations",reviewedImageIds:ids,
 observations:[{id:role+"-candidate",imageId:"frame-3",anatomy:"visible region",sign:"uncertain focus",
  uncertainty:"only 4 frames"}],limitations:["not full CT"],
 ...(opus?{opusSynthesis:{
  schema:"opus-integrated-gemini-detector-synthesis/v1",
  summary:"Черновик: модельный кандидат пространственно привязан к frame-3.",
  radiologistProtocol:{
   schema:"opus-radiologist-protocol/v1",technique:"Оценены четыре изображения CT, не вся серия.",
   description:"Неподтверждённая узловая находка в выбранной области лёгкого.",
   conclusion:"Подозрительное модельное образование требует изучения исходных изображений.",
   recommendations:"Проанализировать полный исходный объём КТ и сопоставить исследования.",
   assessmentScope:"sampled_frames_only",physicianReviewRequired:true,
  },
  comparisons:[{task:"lung_tumor",assessment:"not_comparable",reason:"Одна точка не доказывает совпадение."}],
  conflicts:[],limitations:["Нет контура очага."],sourceCoverage:"sampled_frames_only",clinicallyValidated:false,
 }}:{}),
})}}]});
test("CLN voxel → displayed PNG fractional centroid (flipud transpose) and exact axial frame",()=>{
 const doc=createClnFrameRelativeEvidence(mapping);
 const x=doc.candidateAnchors[0];
 assert.equal(x.frameId,"frame-3");assert.equal(x.axialSliceOffset,0);
 assert.equal(x.xFraction,Math.round(128.5/256*10000)/10000);
 assert.equal(x.yFraction,Math.round((256-84-.5)/256*10000)/10000);
 assert.ok(validateClnFrameRelativeEvidence(doc,ids));
 assert.equal(JSON.stringify(doc).includes(sha),false);
 assert.equal(doc.originalDicomSopRegistrationVerified,false);
});
test("Reject unbound source, invalid coordinates and hallucinated source image",()=>{
 assert.throws(()=>createClnFrameRelativeEvidence({...mapping,detectorSourceImageSha256:"b".repeat(64)}));
 assert.throws(()=>createClnFrameRelativeEvidence({...mapping,nativeCandidates:[{...mapping.nativeCandidates[0],
  sourceVoxelCentroidIJK:[999,20,50]}]}));
 const doc=createClnFrameRelativeEvidence(mapping);
 assert.equal(validateClnFrameRelativeEvidence({...doc,sourceVoxelIJK:[123,23,33]},ids),false);
 assert.equal(validateClnFrameRelativeEvidence({...doc,candidateAnchors:[{...doc.candidateAnchors[0],frameId:"frame-5"}]},ids),false);
});
test("Only Opus gets CLN PNG location; Gemini sees independently; exactly two calls",async()=>{
 const packet=buildVisionPrivacyPacket(ids.map(id=>{
  const f=createPrivacyFrame(png(),id,"CT");
  return markPrivacyReview(markPrivacyReview(f,"pixel",true),"visual",true);
 }),"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
 const spatial=createClnFrameRelativeEvidence(mapping);
 let calls=0;
 const doc=await reviewSanitizedSamples(packet,async(req)=>{
  calls++;const text=JSON.stringify(req.messages);
  if(calls===1){
   assert.equal(req.model,PILOT_GEMINI);
   assert.doesNotMatch(text,/candidateAnchors|axialSliceOffset|xFraction|yFraction|2\.303572/);
   return answer("gemini");
  }
  assert.equal(req.model,PILOT_OPUS);
  assert.match(text,/frame-3/);assert.match(text,/xFraction/);
  assert.match(text,/axialSliceOffset/);assert.match(text,/gemini-candidate/);
  assert.doesNotMatch(text,/SOPInstanceUID|PatientName|sourceImageSha256|sourceVoxelCentroidIJK/);
  return answer("opus",true);
 },undefined,null,bundle,null,null,spatial);
 assert.equal(calls,2);assert.deepEqual(doc.frameRelativeClnEvidence,spatial);
 assert.equal(doc.opusSynthesis?.comparisons.length,1);
});
test("Fake spatial evidence cannot cause paid request",async()=>{
 const packet=buildVisionPrivacyPacket(ids.map(id=>{
  const f=createPrivacyFrame(png(),id,"CT");
  return markPrivacyReview(markPrivacyReview(f,"pixel",true),"visual",true);
 }),"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
 let calls=0;const spy=async()=>{calls++;return answer("bad")};
 const bad={...createClnFrameRelativeEvidence(mapping),candidateAnchors:[{
  ...createClnFrameRelativeEvidence(mapping).candidateAnchors[0],candidateVolumeMl:100
 }]};
 await assert.rejects(reviewSanitizedSamples(packet,spy,undefined,null,bundle,null,null,bad),
  /frame_projection_disagrees/);
 assert.equal(calls,0);
});
