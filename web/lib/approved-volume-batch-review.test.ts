import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview} from "./vision-privacy.ts";
import {reviewApprovedVolumeGeminiBatch} from "./approved-volume-batch-review.ts";
import type {AiGatewayRequest} from "./ai-gateway.ts";

const UUID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function chunk(type:string,payload:Buffer){
  const tag=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);
  len.writeUInt32BE(payload.length);let c=0xffffffff;
  for(const b of Buffer.concat([tag,payload])){
    c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  crc.writeUInt32BE((c^0xffffffff)>>>0);
  return Buffer.concat([len,tag,payload,crc]);
}
function png(){
  const head=Buffer.alloc(13);head.writeUInt32BE(2,0);head.writeUInt32BE(2,4);
  head[8]=8;head[9]=6;
  const pixels=Buffer.from([0,1,2,3,255,4,5,6,255,0,7,8,9,255,10,11,12,255]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR",head),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
}
function packet(count=4,modality:"CT"|"MR"|"CR"="CT"){
  return buildVisionPrivacyPacket(Array.from({length:count},(_,i)=>{
    const f=createPrivacyFrame(png(),"frame-"+(i+1),modality);
    return markPrivacyReview(markPrivacyReview(f,"pixel",true),"visual",true);
  }),UUID);
}
const answer=(ids:string[],usage={prompt_tokens:830,completion_tokens:106})=>({
  choices:[{finish_reason:"stop",message:{content:JSON.stringify({
    role:"observations",reviewedImageIds:ids,
    structuredReview:{structures:[{imageIds:ids,anatomy:'sampled region',visibility:'partial',description:'Visible synthetic region',importantNegatives:[],limitations:'Synthetic, incomplete'}],imageQuality:ids.map(imageId=>({imageId,quality:'limited',limitations:'Synthetic'}))},
    observations:[{id:"obs1",imageId:ids[0],anatomy:"sampled region",
      sign:"Visible pixels only",uncertainty:"Limited slice context",localization:"Visible sampled region",morphology:"Synthetic pixels"}],
    limitations:["Not the entire CT/MR volume"],
  })}}],
  usage,
});
test("Four approved PNGs perform exactly one real provider-interface Gemini call",async()=>{
  const calls:AiGatewayRequest[]=[];
  const result=await reviewApprovedVolumeGeminiBatch(packet(),async req=>{
    calls.push(req);return answer(["frame-1","frame-2","frame-3","frame-4"]);
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].model,"google/gemini-3.8-flash");
  assert.equal(calls[0].role,"vision");
  assert.equal(calls[0].requireParameters,true);
  assert.equal(result.imagesReviewed,4);
  assert.deepEqual(result.receipt,{inputTokens:830,outputTokens:106});
  assert.equal(result.sourceBindingsLocalOnly,true);
  const payload=JSON.stringify(calls[0].messages);
  assert.match(payload,/Unknown contrast stays unknown/);
  assert.match(payload,/OBSERVATION FIRST/);
  assert.match(payload,/LEADING RADIOLOGICAL DIAGNOSIS/);
  assert.match(payload,/Name the body region shown and diagnose only that region/);
  assert.doesNotMatch(payload,/not a diagnosing clinician/);
  assert.doesNotMatch(payload,/No diagnoses, differential/);
  assert.match(payload,/Patient orientation is not provided/);
  assert.match(payload,/Describe ground-glass opacity and consolidation separately/);
  assert.match(payload,/data:image\/png;base64,/);
  for(const forbidden of ["SOPInstanceUID","StudyInstanceUID","PatientName",UUID])
    assert.ok(!payload.includes(forbidden));
});
test("Abdomen context asks for solid-organ diagnoses and omits the chest checklist",async()=>{
  const calls:AiGatewayRequest[]=[];
  const technical={region:"ABDOMEN" as const,sliceSpacingMm:5,pixelSpacingMm:[0.7,0.7] as [number,number],contrast:"UNKNOWN" as const,phase:"UNKNOWN" as const,mrWeighting:"UNKNOWN" as const,mrSequenceCodes:[] as const,window:"SOFT" as const};
  await reviewApprovedVolumeGeminiBatch(packet(),async req=>{calls.push(req);return answer(["frame-1","frame-2","frame-3","frame-4"]);},
    undefined,"clinician-reviewed",{totalFrames:4,sliceNumbers:[1,2,3,4],technical});
  const payload=JSON.stringify(calls[0].messages);
  assert.match(payload,/liver and intrahepatic ducts/);
  assert.doesNotMatch(payload,/Actively evaluate visible mediastinum/);
});
test("Chest context includes mediastinum, nodes, heart and vessels",async()=>{
  const calls:AiGatewayRequest[]=[];
  const technical={region:"CHEST" as const,sliceSpacingMm:5,pixelSpacingMm:[0.7,0.7] as [number,number],contrast:"UNKNOWN" as const,phase:"UNKNOWN" as const,mrWeighting:"UNKNOWN" as const,mrSequenceCodes:[] as const,window:"LUNG" as const};
  await reviewApprovedVolumeGeminiBatch(packet(),async req=>{calls.push(req);return answer(["frame-1","frame-2","frame-3","frame-4"]);},
    undefined,"clinician-reviewed",{totalFrames:4,sliceNumbers:[1,2,3,4],technical});
  assert.match(JSON.stringify(calls[0].messages),/Actively evaluate visible mediastinum, nodes, heart, vessels/);
});
test("One real MR frame can be reviewed without asserting absent disease",async()=>{
  const r=await reviewApprovedVolumeGeminiBatch(packet(1,"MR"),
    async()=>answer(["frame-1"]));
  assert.equal(r.modality,"MR");
  assert.equal(r.imagesReviewed,1);
  assert.equal(r.clinicalValidation,false);
});
test("Unreviewed, altered, mixed, and non-volume frames refuse paid calls",async()=>{
  for(const p of [
    packet(1,"CR"),
    {...packet(1),frames:packet(1).frames.map(f=>({...f,pixelReviewSha256:null}))},
    {...packet(1),transmissionPermitted:true},
    {...packet(1),frames:packet(1).frames.map(f=>({...f,sha256:"a".repeat(64)}))},
  ]){
    let calls=0;
    await assert.rejects(reviewApprovedVolumeGeminiBatch(p,async()=>{
      calls++;return answer(["frame-1"]);
    }));
    assert.equal(calls,0);
  }
});
test("Missing token accounting, partial acknowledgements, and unanchored observations fail",async()=>{
  for(const response of [
    answer(["frame-1"],{prompt_tokens:NaN,completion_tokens:4}),
    answer(["frame-1"],{prompt_tokens:0.2,completion_tokens:1}),
    answer(["frame-1"]),
    {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      role:"observations",reviewedImageIds:["frame-1","frame-2"],
      observations:[{id:"1",imageId:"frame-99",anatomy:"a",sign:"b",uncertainty:"c"}],
      limitations:[]})}}],usage:{prompt_tokens:5,completion_tokens:5}},
  ]){
    await assert.rejects(reviewApprovedVolumeGeminiBatch(packet(2),async()=>response));
  }
});
