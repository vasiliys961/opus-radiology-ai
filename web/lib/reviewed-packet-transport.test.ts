import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {buildVisionPrivacyPacket,createPrivacyFrame,markPrivacyReview,type PrivacyFrame} from './vision-privacy.ts';
import {splitReviewedTransport,partitionReviewedFrames} from './reviewed-packet-transport.ts';
function chunk(type:string,payload:Buffer){
 const tag=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(payload.length);
 let c=0xffffffff;for(const b of Buffer.concat([tag,payload])){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}crc.writeUInt32BE((c^0xffffffff)>>>0);
 return Buffer.concat([length,tag,payload,crc]);
}
test('real large reviewed PNGs split before transfer without pixel changes or source index loss',()=>{
 const width=512,height=512,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const rows=Buffer.alloc(height*(width*4+1));let seed=937;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=y*(width*4+1)+1+x*4;
  for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;rows[at+c]=seed>>>24;}rows[at+3]=255;
 }
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
 const frames=Array.from({length:4},(_,i)=>markPrivacyReview(markPrivacyReview(createPrivacyFrame(png,'frame-'+(i+1),'CT'),'pixel',true),'visual',true));
 assert.ok(frames.reduce((n,f)=>n+f.pngBase64.length,0)>2350000);
 const packet=buildVisionPrivacyPacket(frames,crypto.randomUUID());
 const result=splitReviewedTransport([packet],[{pass:'overview',indices:[59,60,61,62]}]);
 assert.ok(result.packets.length>1);assert.deepEqual(result.batches.flatMap(b=>b.indices),[59,60,61,62]);
 assert.deepEqual(result.packets.flatMap(p=>p.frames).map(f=>f.sha256),frames.map(f=>f.sha256));
 for(const p of result.packets){assert.ok(p.frames.reduce((n,f)=>n+f.pngBase64.length,0)<=2000000);assert.ok(JSON.stringify(p).length<2350000);assert.ok(p.frames.every((f,i)=>f.frameId==='frame-'+(i+1)&&f.visualReviewSha256===f.sha256));}
 assert.throws(()=>splitReviewedTransport([packet],[{pass:'overview',indices:[59]}]));
});
test('an individually oversized copy is refused locally; no resizing or guard increase',()=>{
 assert.throws(()=>partitionReviewedFrames([{pngBase64:'x'.repeat(2000001)} as PrivacyFrame]));
});
