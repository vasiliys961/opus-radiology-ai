import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview} from "./vision-privacy.ts";
import {normalizeReviewedCloudPilot,reviewSanitizedSamples,PILOT_GEMINI,PILOT_OPUS} from "./sanitized-cloud-review.ts";
import type {AiGatewayRequest} from "./ai-gateway.ts";
import {toSafeXrvScores,type OriginalXrvCxrResult,SHA_XRV} from "./xrv-original-cxr.ts";

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
function packet(modality:"CT"|"MR"|"CR"|"DX"="CT"){
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


test("R231 anatomical measurements reach Opus only after independent Gemini image inspection",async()=>{
  const facts={schema:"opus-local-r231-facts/v1" as const,model:"lungmask-R231" as const,
    frameCount:32,rightLungMaskMl:1320.25,leftLungMaskMl:1240.75,
    coverage:"not-clinically-verified" as const,masksAreNotPathologyDetectors:true as const};
  const calls:AiGatewayRequest[]=[];
  const doc=await reviewSanitizedSamples(packet("CT"),async req=>{
    calls.push(req);return answer(req.model===PILOT_GEMINI?"gemini":"opus");
  },undefined,facts);
  assert.equal(calls.length,2);
  const independent=JSON.stringify(calls[0].messages);
  const compared=JSON.stringify(calls[1].messages);
  assert.doesNotMatch(independent,/1320.25|1240.75|lungmask-R231/);
  assert.match(compared,/1320.25/);
  assert.match(compared,/1240.75/);
  for(const text of [independent,compared])
    assert.doesNotMatch(text,/sourceIdentitySha256|inputSha256|patientName|SOPInstanceUID|patientUid/i);
  assert.deepEqual(doc.specialistEvidence,{
    model:"lungmask-R231",frameCount:32,rightLungMaskMl:1320.25,
    leftLungMaskMl:1240.75,clinicalProvenanceServerVerified:false,
    findingOfPathologyEstablished:false,
  });
});
test("Patient text and forged R231 labels never reach provider; MR cannot reuse CT facts",async()=>{
  const good={schema:"opus-local-r231-facts/v1",model:"lungmask-R231",
    frameCount:32,rightLungMaskMl:1320,leftLungMaskMl:1240,
    coverage:"not-clinically-verified",masksAreNotPathologyDetectors:true};
  for(const [data,input] of [
    [packet("CT"),{...good,patientName:"Not for cloud"}],
    [packet("CT"),{...good,model:"untrusted-pathology-model"}],
    [packet("CT"),{...good,rightLungMaskMl:Infinity}],
    [packet("MR"),good],
  ]as const){
    let calls=0;
    await assert.rejects(reviewSanitizedSamples(data,async()=>{
      calls++;return answer("bad");
    },undefined,input));
    assert.equal(calls,0);
  }
});


test("Genuine selected-study model counts join Gemini Vision -> Opus without DICOM identities",async()=>{
 const bundle={
  schema:"opus-sanitized-detector-consilium/v1" as const,modality:"CT" as const,
  region:"chest" as const,
  facts:[
   {task:"lung_nodules" as const,status:"completed" as const,candidateCount:2,candidateVolumeMl:null},
   {task:"lung_tumor" as const,status:"not_assessed" as const,candidateCount:null,candidateVolumeMl:null},
   {task:"lungscape_model_regions" as const,status:"not_assessed" as const,candidateCount:null,candidateVolumeMl:null},
   {task:"pleural_effusion" as const,status:"not_assessed" as const,candidateCount:null,candidateVolumeMl:null},
   {task:"pericardial_effusion" as const,status:"not_assessed" as const,candidateCount:null,candidateVolumeMl:null},
   {task:"pulmonary_embolism" as const,status:"not_assessed" as const,candidateCount:null,candidateVolumeMl:null},
   {task:"mediastinal_nodes" as const,status:"not_assessed" as const,candidateCount:null,candidateVolumeMl:null},
  ],sourceIdentifiersSent:false as const,sourcePixelsSent:false as const,
  clinicalValidation:false as const,negativeDiagnosisPermitted:false as const,
 };
 const sent:AiGatewayRequest[]=[];
 const result=await reviewSanitizedSamples(packet(),async req=>{
  sent.push(req);return answer(req.model===PILOT_GEMINI?"gemini-source-frame":"opus-source-frame");
 },undefined,null,bundle);
 assert.equal(sent.length,2);
 assert.deepEqual(sent.map(x=>x.model),[PILOT_GEMINI,PILOT_OPUS]);
 const geminiPrompt=JSON.stringify(sent[0].messages);
 const opusPrompt=JSON.stringify(sent[1].messages);
 assert.doesNotMatch(geminiPrompt,/lung_nodules|not_assessed|candidateCount/);
 assert.match(opusPrompt,/gemini-source-frame/);
 assert.match(opusPrompt,/lung_nodules/);
 assert.match(opusPrompt,/not_assessed/);
 assert.equal(result.detectorEvidence?.facts[0].candidateCount,2);
 assert.equal(result.sourceDicomIdentifiersSent,false);
 for(const text of [geminiPrompt,opusPrompt])
   assert.doesNotMatch(text,/PatientName|SOPInstanceUID|SourceFile|sourceNiftiSha256|modelCheckpoint/);
});
test("Wrong modality or forged task statuses never reach either Vision model",async()=>{
 const wrong={
  schema:"opus-sanitized-detector-consilium/v1",modality:"MR",region:"chest",
  facts:[],sourceIdentifiersSent:false,sourcePixelsSent:false,
  clinicalValidation:false,negativeDiagnosisPermitted:false,
 };
 let called=0;
 await assert.rejects(reviewSanitizedSamples(packet(),async()=>{
  called++;return answer("should-not-call");
 },undefined,null,wrong));
 assert.equal(called,0);
});


test("Real XRV numeric score evidence is withheld from Gemini CXR Vision, then shown to Opus",async()=>{
 const original={
  schema:"opus-original-xrv-cxr-six-head/v1",
  sourcePngSha256:"a".repeat(64),
  model:"densenet121-res224-nih",
  modelWeightSha256:SHA_XRV,
  actualPretrainedModelForwardCompleted:true,
  labels:{Pneumothorax:.172315,Cardiomegaly:.667162,
   Effusion:.566473,Pneumonia:.501093,Edema:.501593,Mass:.532159},
  spatialLocalizationSupported:false,
  clinicalValidation:false,scoresAreCalibratedProbabilities:false,
  negativeDiagnosisPermitted:false,patientMode:false,
  limitations:["research only","no clinical accuracy","not an image-level diagnosis"],
 } as OriginalXrvCxrResult;
 const sanitized=toSafeXrvScores(original);
 assert.equal(JSON.stringify(sanitized).includes(original.sourcePngSha256),false);
 const calls:AiGatewayRequest[]=[];
 const output=await reviewSanitizedSamples(packet("DX"),async req=>{
  calls.push(req);
  return answer(req.model===PILOT_GEMINI?"gemini-independent":"opus-after-comparison");
 },undefined,null,null,sanitized);
 assert.equal(calls.length,2);
 assert.deepEqual(calls.map(x=>x.model),[PILOT_GEMINI,PILOT_OPUS]);
 const first=JSON.stringify(calls[0].messages),second=JSON.stringify(calls[1].messages);
 assert.doesNotMatch(first,/Cardiomegaly|0\.667162|TorchXRayVision|NIH-DenseNet121/);
 assert.match(first,/AP\/PA/);
 assert.match(second,/Cardiomegaly/);
 assert.match(second,/0\.667162/);
 assert.match(second,/gemini-independent/);
 assert.equal(output.cxrModelEvidence?.labels.Cardiomegaly,.667162);
 assert.equal(output.modality,"DX");
 for(const msg of [first,second])assert.doesNotMatch(msg,/sourcePngSha256|originalTrainedCheckpointSHA256|patientName/);
 let attempted=0;
 await assert.rejects(reviewSanitizedSamples(packet("CT"),async()=>{
  attempted++;return answer("should-not-call");
 },undefined,null,null,sanitized),/CR\/DX/);
 assert.equal(attempted,0);
});
