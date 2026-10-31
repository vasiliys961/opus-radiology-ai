/**
 * One-time paid OpenRouter diagnostic, run only in explicitly authorized GitHub CI.
 * Images are generated RGB mathematical shapes; never reads files or patient data.
 * Exactly two allowed paid requests: Gemini first, Claude Opus second, no retries.
 */
import {deflateSync} from "node:zlib";
import assert from "node:assert/strict";
import {buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview} from "../web/lib/vision-privacy.ts";
import {reviewSanitizedSamples,PILOT_GEMINI,PILOT_OPUS} from "../web/lib/sanitized-cloud-review.ts";
import {callAiGateway} from "../web/lib/ai-gateway.ts";
if(process.env.OPUS_SYNTHETIC_LIVE_TEST_APPROVED!=="true")
  throw Error("Synthetic paid test requires explicit CI opt-in");
if(!process.env.OPENROUTER_API_KEY?.trim()){
 console.error("BLOCKED: OPENROUTER_API_KEY is not configured in this GitHub Actions environment.");
 process.exit(3);
}
function crc32(bytes){
 let crc=0xffffffff;
 for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function chunk(tag,data){
 const t=Buffer.from(tag),size=Buffer.alloc(4),checksum=Buffer.alloc(4);
 size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([t,data])));
 return Buffer.concat([size,t,data,checksum]);
}
function mathematicalPng(){
 const width=128,height=128,raw=Buffer.alloc(height*(width*3+1));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const nx=(x-64)/64,ny=(y-64)/64;
  const inside=(nx*nx)/0.76+(ny*ny)/0.84<1;
  const left=((nx+0.28)/0.23)**2+((ny-0.08)/0.62)**2<1;
  const right=((nx-0.28)/0.23)**2+((ny-0.08)/0.62)**2<1;
  const intensity=!inside?10:(left||right)?40:155;
  const at=y*(width*3+1)+1+3*x;
  raw[at]=intensity;raw[at+1]=intensity;raw[at+2]=intensity;
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);
 ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}
const clean=createPrivacyFrame(mathematicalPng(),"frame-1","CT");
const reviewed=markPrivacyReview(markPrivacyReview(clean,"pixel",true),"visual",true);
const packet=buildVisionPrivacyPacket([reviewed],"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
assert.equal(packet.frames.length,1);
let attempted=0,successful=0;
const models=[],usages=[];
try{
 const result=await reviewSanitizedSamples(packet,async(request,signal)=>{
  assert.equal(request.provider,"openrouter");
  assert.equal(request.role,"vision");
  assert.equal(request.model,attempted===0?PILOT_GEMINI:PILOT_OPUS);
  assert.ok(attempted<2,"Never issue a third paid model request");
  attempted++;
  const response=await callAiGateway(request,signal);
  successful++;
  models.push(response.model);
  usages.push(response.usage??null);
  return response;
 },AbortSignal.timeout(180000));
 assert.equal(attempted,2);assert.equal(successful,2);
 assert.equal(result.results[0].reviewer,"gemini");
 assert.equal(result.results[1].reviewer,"opus");
 assert.equal(result.originalDicomSent,false);
 assert.equal(result.sourceDicomIdentifiersSent,false);
 assert.equal(result.results[0].review.reviewedImageIds[0],"frame-1");
 assert.equal(result.results[1].review.reviewedImageIds[0],"frame-1");
 console.log("PASS: OpenRouter completed Gemini Vision -> Claude Opus using nonpatient 128x128 RGB PNG.");
 console.log(JSON.stringify({realCalls:successful,models,tokenUsage:usages,
  observations:result.results.map(x=>({reviewer:x.reviewer,count:x.review.observations.length})),
  sourceFrames:result.sourceFrames.length,clinicalValidation:false}));
}catch(error){
 console.error("LIVE SYNTHETIC TEST FAILED",JSON.stringify({
   paidCallsAttempted:attempted,successfulResponses:successful,
   errorName:error instanceof Error?error.name:"Unknown",
   // Do not log provider payload, raw completions, tokens, images, or credentials.
   failureKind:error instanceof Error && /^AI provider returned HTTP [0-9]{3}$/.test(error.message)
     ?error.message:"Provider response or strict source-frame JSON validation failed",
 }));
 process.exitCode=1;
}
