import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync,inflateSync } from "node:zlib";
import { buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview,pngFromBase64,stripPngMetadata,validatePrivacyRectangle,
  MAX_PRIVACY_PNG_BYTES,type PrivacyFrame } from "./vision-privacy.ts";
import { evaluatePatientCloudRelease } from "./patient-cloud-policy.ts";
import { redactPrivacyFrame } from "./vision-privacy-browser.ts";

const packetId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function chunk(type:string,payload:Buffer){
  const tag=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(payload.length);
  let crc=0xffffffff;for(const byte of Buffer.concat([tag,payload])){
    crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,tag,payload,checksum]);
}
function png({width=2,height=2,color=6,bits=8,interlace=0,extra=[]}: {
  width?:number;height?:number;color?:number;bits?:number;interlace?:number;extra?:Buffer[]
}={}){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=bits;header[9]=color;header[12]=interlace;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),...extra,
    chunk("IDAT",deflateSync(Buffer.from([0,10,20,30,255,40,50,60,255,0,70,80,90,255,100,110,120,255]))),chunk("IEND",Buffer.alloc(0))]);
}
function reviewed(frameId="frame-1"):PrivacyFrame {
  return markPrivacyReview(markPrivacyReview(createPrivacyFrame(png(),frameId,"CT"),"pixel",true),"visual",true);
}

test("PNG cleaning removes every ancillary metadata block while retaining identical raster bytes",()=>{
  const dirty=png({extra:["tEXt","iTXt","zTXt","eXIf","iCCP","vpAg"].map(tag=>chunk(tag,Buffer.from("SYNTHETIC-PHI-SENTINEL")))});
  const clean=stripPngMetadata(dirty);
  assert.deepEqual(Buffer.from(clean.bytes),png());assert.equal(clean.width,2);assert.equal(clean.height,2);
  assert.equal(Buffer.from(clean.bytes).includes(Buffer.from("SYNTHETIC-PHI-SENTINEL")),false);
  const at=33,length=Buffer.from(clean.bytes).readUInt32BE(at);
  assert.deepEqual(inflateSync(clean.bytes.subarray(at+8,at+8+length)),Buffer.from([0,10,20,30,255,40,50,60,255,0,70,80,90,255,100,110,120,255]));
});

test("malformed PNG/CRC/trailer/critical chunks cannot be accepted as cleaned images",()=>{
  const corrupt=png();corrupt[45]^=1;
  for(const bytes of [new Uint8Array(),corrupt,png().subarray(0,40),Buffer.concat([png(),Buffer.from("private trailer")]),
    png({extra:[chunk("ABCD",Buffer.from("unknown critical"))]}),png({extra:[chunk("IHDR",Buffer.alloc(13))]})])
    assert.throws(()=>stripPngMetadata(bytes));
});

test("pixel/byte/encoding guards refuse excessive or unsupported allocations",()=>{
  for(const options of [{width:1025,height:1024},{width:0},{bits:16},{color:3},{interlace:1}])
    assert.throws(()=>stripPngMetadata(png(options)));
  assert.throws(()=>stripPngMetadata(new Uint8Array(MAX_PRIVACY_PNG_BYTES+1)),/2 МиБ/);
  assert.throws(()=>pngFromBase64("x".repeat(3_000_000)));assert.throws(()=>pngFromBase64("!"));
  assert.throws(()=>pngFromBase64("Zh==")); // noncanonical padding bits
  assert.equal(pngFromBase64(Buffer.alloc(MAX_PRIVACY_PNG_BYTES).toString("base64")).length,MAX_PRIVACY_PNG_BYTES);
  assert.throws(()=>createPrivacyFrame(png(),"patient-filename","CT"));
  assert.throws(()=>createPrivacyFrame(png(),"frame-1","US" as "CT"));
});

test("bounded redaction rectangles must cover real pixels inside the current frame",()=>{
  assert.deepEqual(validatePrivacyRectangle({x:0,y:0,width:2,height:2},2,2),{x:0,y:0,width:2,height:2});
  for(const r of [{x:-1,y:0,width:1,height:1},{x:2,y:0,width:1,height:1},{x:0,y:0,width:0,height:1},
    {x:0,y:0,width:3,height:1},{x:0.5,y:0,width:1,height:1},{x:0,y:NaN,width:1,height:1}])
    assert.throws(()=>validatePrivacyRectangle(r,2,2));
  assert.throws(()=>createPrivacyFrame(png(),"frame-1","CT",Array(33).fill({x:0,y:0,width:1,height:1})));
});

test("each exact image requires both local reviews; changed image/hash invalidates old review",()=>{
  const draft=createPrivacyFrame(png(),"frame-1","MR");
  assert.throws(()=>buildVisionPrivacyPacket([draft],packetId),/Проверьте/);
  assert.throws(()=>buildVisionPrivacyPacket([markPrivacyReview(draft,"pixel",true)],packetId),/Проверьте/);
  const both=markPrivacyReview(markPrivacyReview(draft,"pixel",true),"visual",true);
  assert.equal(buildVisionPrivacyPacket([both],packetId).frames[0].pixelReviewSha256,both.sha256);
  for(const changed of [{sha256:"f".repeat(64)},{pixelReviewSha256:"f".repeat(64)},{width:3}])
    assert.throws(()=>buildVisionPrivacyPacket([{...both,...changed}],packetId),/Проверьте/);
  const replacement=createPrivacyFrame(png(),"frame-1","MR",[{x:0,y:0,width:1,height:1}]);
  assert.equal(replacement.pixelReviewSha256,null);assert.equal(replacement.visualReviewSha256,null);
});

test("packet allowlist omits original IDs, names, clinical text and opaque fields without reading them",()=>{
  const frame=reviewed();
  for(const key of ["sopInstanceUid","filename","patientName","clinicalContext","opaqueDicom"])
    Object.defineProperty(frame,key,{enumerable:true,get(){throw new Error("Must stay local");}});
  const raw=JSON.stringify(buildVisionPrivacyPacket([frame],packetId));
  assert.doesNotMatch(raw,/sopInstanceUid|filename|patientName|clinicalContext|opaqueDicom/);
  assert.deepEqual(Object.keys(JSON.parse(raw).frames[0]),["frameId","modality","width","height","pngBase64","sha256","redactions","pixelReviewSha256","visualReviewSha256"]);
});

test("empty/duplicate/excess frames and source-derived packet identifiers are refused",()=>{
  for(const frames of [[],[reviewed(),reviewed()],Array.from({length:5},(_,i)=>reviewed(`frame-${i%4+1}`))])
    assert.throws(()=>buildVisionPrivacyPacket(frames,packetId));
  assert.throws(()=>buildVisionPrivacyPacket([reviewed()],"source-uid"));
  assert.equal(buildVisionPrivacyPacket([reviewed("frame-1"),reviewed("frame-2"),reviewed("frame-3"),reviewed("frame-4")],packetId).frames.length,4);
});

test("local reviews never promote a candidate to trusted de-identification or cloud release",()=>{
  const packet=buildVisionPrivacyPacket([reviewed()],packetId);
  assert.equal(packet.transmissionPermitted,false);assert.equal(packet.deidentificationVerified,false);
  assert.equal(packet.status,"local-review-draft");assert.equal(packet.coverage,"sampled-frames-only");
  assert.equal(evaluatePatientCloudRelease({dicomDeidentification:true,pixelPrivacy:true}).permitted,false);
});

test("redaction revalidates image bounds, SHA and rectangle count before allocating a browser decoder",async()=>{
  const frame=reviewed(),r={x:0,y:0,width:1,height:1};
  await assert.rejects(redactPrivacyFrame({...frame,width:3},r),/Размер или SHA/);
  await assert.rejects(redactPrivacyFrame({...frame,sha256:"f".repeat(64)},r),/Размер или SHA/);
  await assert.rejects(redactPrivacyFrame({...frame,pngBase64:"x".repeat(3_000_000)},r),/слишком большая/);
  await assert.rejects(redactPrivacyFrame({...frame,redactions:Array(32).fill(r)},r),/лимит 32/);
  await assert.rejects(redactPrivacyFrame(frame,{...r,width:3}),/внутри кадра/);
});
