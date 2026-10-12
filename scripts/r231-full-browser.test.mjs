import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectSlab,fullMaskHeader} from './r231-full-browser.mjs';

function fixture(start=32,count=3) {
  const request={requestId:'request',sourceIdentitySha256:'source',inputSha256:'input',
    geometry:{dimensions:[512,512,103],affineLps:[1,0,0,-250,0,1,0,-156,0,0,-3,343]}};
  const result={maskSha256:'full-mask'};
  const affine=[...request.geometry.affineLps];affine[11]+=affine[10]*start;
  const bytes=Buffer.alloc(352+512*512*count);bytes.writeInt32LE(348);bytes.writeInt16LE(3,40);
  [512,512,count].forEach((n,i)=>bytes.writeInt16LE(n,42+i*2));
  bytes.writeInt16LE(2,70);bytes.writeInt16LE(8,72);bytes.write('n+1\0',344);
  affine.forEach((n,i)=>bytes.writeFloatLE(i<8?-n:n,280+i*4));bytes[352]=1;bytes[353]=2;
  const proof={schema:'opus-full-ct-slab/v1',jobId:'job',requestId:'request',sourceIdentitySha256:'source',inputSha256:'input',
    fullMaskSha256:'full-mask',start,count,sourceFrameCount:103,geometry:{dimensions:[512,512,count],affineLps:affine},
    slabMaskSha256:createHash('sha256').update(bytes).digest('hex')};
  return {bytes,request,result,proof,start,count};
}
const encode=p=>Buffer.from(JSON.stringify(p)).toString('base64');
test('signed native slab header, proof, hash and independent counts',()=>{
  const f=fixture();assert.deepEqual(inspectSlab(f.bytes,encode(f.proof),f.request,f.result,f.start,f.count).counts,[512*512*3-2,1,1]);
});
test('foreign source, full mask, wrong range or shifted grid cannot pass',()=>{
  for(const change of [{inputSha256:'other'},{sourceIdentitySha256:'other'},{fullMaskSha256:'other'},{start:31},{count:4},{sourceFrameCount:32},
    {geometry:{dimensions:[512,512,3],affineLps:Array(12).fill(0)}}]) {
    const f=fixture();assert.throws(()=>inspectSlab(f.bytes,encode({...f.proof,...change}),f.request,f.result,f.start,f.count));
  }
});
test('corrupted bytes, invalid label and physical header fail independently',()=>{
  for(const change of [b=>{b[352]=7;},b=>b.writeFloatLE(0,324),b=>b.writeInt16LE(4,46)]) {
    const f=fixture();change(f.bytes);
    // Recompute a matching SHA: geometry/label checks still reject an invalid mask.
    f.proof.slabMaskSha256=createHash('sha256').update(f.bytes).digest('hex');
    assert.throws(()=>inspectSlab(f.bytes,encode(f.proof),f.request,f.result,f.start,f.count));
  }
  const f=fixture();f.bytes[354]=1;
  assert.throws(()=>inspectSlab(f.bytes,encode(f.proof),f.request,f.result,f.start,f.count));
});
test('peripheral empty mask is not falsely rejected as an empty whole result',()=>{
  const f=fixture(96,7);f.bytes.fill(0,352);f.proof.slabMaskSha256=createHash('sha256').update(f.bytes).digest('hex');
  assert.deepEqual(inspectSlab(f.bytes,encode(f.proof),f.request,f.result,96,7).counts,[512*512*7,0,0]);
});

test('full-mask header retains exact source bytes including signed zero',()=>{
  const f=fixture(0,32),input=Buffer.from(f.bytes.subarray(0,352));input.writeInt16LE(103,46);
  input.writeInt16LE(16,70);input.writeInt16LE(32,72);input.writeFloatLE(-0,288);
  const output=fullMaskHeader(input);assert.equal(output.readInt16LE(46),103);
  assert.equal(output.readInt16LE(70),2);assert.equal(output.readInt16LE(72),8);
  assert.ok(Object.is(output.readFloatLE(288),-0));assert.equal(input.readInt16LE(70),16);
  const expected=Buffer.from(input);expected.writeInt16LE(2,70);expected.writeInt16LE(8,72);
  assert.deepEqual(output,expected);
});
