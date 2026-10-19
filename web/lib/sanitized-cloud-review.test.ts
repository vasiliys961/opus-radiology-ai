import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview} from "./vision-privacy.ts";
import {normalizeReviewedCloudPilot,reviewSanitizedSamples,PILOT_GEMINI,PILOT_OPUS} from "./sanitized-cloud-review.ts";
import type {AiGatewayRequest} from "./ai-gateway.ts";

const UUID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function chunk(type:string,payload:Buffer){
  const tag=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);
  length.writeUInt32BE(payload.length);let c=0xffffffff;
  for(const b of Buffer.concat([tag,payload])){
    c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  crc.writeUInt32BE((c^0xffffffff)>>>0);
  return Buffer.concat([length,tag,payload,crc]);
}
function testPng(){
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);
  header[8]=8;header[9]=6;
  const data=Buffer.from([0,1,2,3,255,4,5,6,255,0,7,8,9,255,10,11,12,255]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR",header),chunk("IDAT",deflateSync(data)),chunk("IEND",Buffer.alloc(0))]);
}
function packet(modality:"CT"|"MR"="CT"){
  const f=createPrivacyFrame(testPng(),"frame-1",modality);
  return buildVisionPrivacyPacket([
    markPrivacyReview(markPrivacyReview(f,"pixel",true),"visual",true),
  ],UUID);
}
const answer=(label:string)=>({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
  role:"observations",reviewedImageIds:["frame-1"],
  observations:[{id:label,imageId:"frame-1",anatomy:"abstract synthetic region",
    sign:"visible pixels",uncertainty:"sampled 2D image only"}],
  limitations:["No full 3D study was reviewed."],
})}}]});
test("Exact reviewed and metadata-stripped PNG is all that can reach the gateway",async()=>{
  const sent:AiGatewayRequest[]=[];
  const result=await reviewSanitizedSamples(packet(),async req=>{
    sent.push(req);return answer(req.model===PILOT_GEMINI?"gemini-a":"opus-a");
  });
  assert.equal(result.results.length,2);
  assert.deepEqual(sent.map(x=>x.model),[PILOT_GEMINI,PILOT_OPUS]);
  assert.equal(result.originalDicomSent,false);
  assert.equal(result.sourceDicomIdentifiersSent,false);
  assert.equal(result.deidentificationIndependentlyCertified,false);
  assert.equal(result.patientDataCanStillBeSensitive,true);
  for(const r of sent){
    assert.equal(r.provider,"openrouter");
    assert.equal(r.role,"vision");
    const prompt=JSON.stringify(r.messages);
    assert.match(prompt,/data:image\/png;base64,/);
    for(const forbidden of ["SOPInstanceUID","PatientName","StudyInstanceUID",
      "SourceFile","PatientBirthDate",UUID])assert.ok(!prompt.includes(forbidden));
    assert.ok(prompt.includes("frame-1"));
  }
  assert.equal(result.results[0].review.observations[0].id,"gemini-a");
  assert.equal(result.results[1].review.observations[0].id,"opus-a");
});
test("Changes, missing independent reviews and spoofed cloud clearance fail before calls",async()=>{
  const source=packet();
  for(const forged of [
    {...source,transmissionPermitted:true},
    {...source,deidentificationVerified:true},
    {...source,frames:source.frames.map(f=>({...f,sha256:"0".repeat(64)}))},
    {...source,frames:source.frames.map(f=>({...f,pixelReviewSha256:null}))},
    {...source,frames:source.frames.map(f=>({...f,visualReviewSha256:null}))},
    {...source,frames:source.frames.map(f=>({...f,pngBase64:"x".repeat(100)}))},
    {...source,frames:[...source.frames,{...source.frames[0],frameId:"frame-2",modality:"MR"}]},
  ]){
    let called=0;
    await assert.rejects(reviewSanitizedSamples(forged,async()=>{
      called++;return answer("not-called");
    }));
    assert.equal(called,0);
  }
});
test("Extra caller fields cannot be forwarded into provider messages",async()=>{
  const dirty=packet() as unknown as Record<string,unknown>;
  dirty.PatientName="SENTINEL-PRIVATE-NAME";
  dirty.DICOM_StudyUid="SENTINEL-PRIVATE-UID";
  (dirty.frames as Array<Record<string,unknown>>)[0].patientNarrative="SENTINEL-PRIVATE-NOTE";
  const sent:string[]=[];
  await reviewSanitizedSamples(dirty,async request=>{
    sent.push(JSON.stringify(request.messages));return answer("fine");
  });
  assert.equal(sent.length,2);
  for(const s of sent)assert.doesNotMatch(s,/SENTINEL/);
});
test("Model output must be source-frame anchored; invalid hallucinated frame aborts",async()=>{
  const wrong={choices:[{finish_reason:"stop",message:{content:JSON.stringify({
    role:"observations",reviewedImageIds:["a-different-patient"],
    observations:[],limitations:[],
  })}}]};
  await assert.rejects(reviewSanitizedSamples(packet("MR"),async r=>
    r.model===PILOT_GEMINI?wrong:answer("opus")),/contract/);
});
test("Normalization exposes only synthetic frame IDs, exact hashes and image bytes",()=>{
  const p=packet("MR");
  const result=normalizeReviewedCloudPilot(p);
  assert.equal(result.modality,"MR");
  assert.deepEqual(Object.keys(result),["modality","frames","localFrameHashes"]);
  assert.deepEqual(Object.keys(result.frames[0]),["imageId","base64"]);
  assert.equal(result.frames[0].imageId,"frame-1");
  assert.equal(result.localFrameHashes[0].reviewedPixelSha256,p.frames[0].sha256);
});
