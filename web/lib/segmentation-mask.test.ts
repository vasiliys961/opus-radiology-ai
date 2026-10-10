import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { assertMaskMatchesSource, invertAffine, MAX_MASK_FILE_BYTES, parseNiftiMask, readNiftiMaskFile, renderMaskPlane, sourceGeometry, transformPoint, type Affine, type Point3 } from "./segmentation-mask.ts";

const AFFINE: Affine = [1,0,0,10,0,1,0,20,0,0,2.5,30];
function fixture({little=true, dimensions=[3,2,2], affine=AFFINE, datatype=512, labels=[0,1,1,0,2,2,0,1,1,0,2,2]}:
  {little?:boolean; dimensions?:Point3; affine?:Affine; datatype?:number; labels?:number[]}={}) {
  const bytes = datatype===16 ? 4 : datatype===2 ? 1 : 2;
  const count = dimensions.reduce((a,b)=>a*b,1);
  const buffer = new ArrayBuffer(352+count*bytes), v=new DataView(buffer);
  v.setInt32(0,348,little);v.setInt16(40,3,little);
  dimensions.forEach((n,i)=>v.setInt16(42+i*2,n,little));
  v.setInt16(70,datatype,little);v.setInt16(72,bytes*8,little);
  v.setFloat32(80,1,little);v.setFloat32(84,1,little);v.setFloat32(88,2.5,little);
  v.setFloat32(108,352,little);v.setUint8(123,2);v.setInt16(254,1,little);
  affine.forEach((n,i)=>v.setFloat32(280+i*4,n*(i<8?-1:1),little));
  [110,43,49,0].forEach((n,i)=>v.setUint8(344+i,n));
  for(let i=0;i<count;i++) {
    const n=labels[i]??0, at=352+i*bytes;
    if(datatype===16)v.setFloat32(at,n,little);
    else if(datatype===2)v.setUint8(at,n);
    else v.setUint16(at,n,little);
  }
  return buffer;
}
test("NIfTI sform is converted from RAS to LPS including translation, without mirror errors",()=>{
  const mask=parseNiftiMask(fixture());
  assert.deepEqual(mask.affineLps,AFFINE);
  assert.deepEqual(mask.dimensions,[3,2,2]);
  assert.deepEqual(mask.labels,[{id:1,voxels:4,volumeMl:0.01},{id:2,voxels:4,volumeMl:0.01}]);
  assert.deepEqual(transformPoint(mask.inverseLps,[12,21,32.5]),[2,1,1]);
});
test("big-endian and uint8 masks decode correctly",()=>{
  assert.deepEqual([...parseNiftiMask(fixture({little:false})).data],[0,1,1,0,2,2,0,1,1,0,2,2]);
  assert.equal(parseNiftiMask(fixture({datatype:2})).labels.length,2);
});
test("float storage permits integer labels and rejects probability maps or negative labels",()=>{
  assert.equal(parseNiftiMask(fixture({datatype:16})).labels.length,2);
  assert.throws(()=>parseNiftiMask(fixture({datatype:16,labels:[0,0.6]})),/вероятности/);
  assert.throws(()=>parseNiftiMask(fixture({datatype:16,labels:[-1]})),/отрицательные/);
});
test("qform-only mask honors qfac and derives the same physical grid",()=>{
  const buffer=fixture(); const v=new DataView(buffer);
  v.setInt16(254,0,true);v.setInt16(252,1,true);v.setFloat32(76,-1,true);
  v.setFloat32(268,-10,true);v.setFloat32(272,-20,true);v.setFloat32(276,30,true);
  const mask=parseNiftiMask(buffer);
  assert.deepEqual(mask.affineLps.map(v=>v===0?0:v),[-1,0,0,10,0,-1,0,20,0,0,-2.5,30]);
});
test("qform and sform conflicts are rejected instead of arbitrarily choosing a space",()=>{
  const buffer=fixture(); const v=new DataView(buffer);
  v.setInt16(252,1,true);
  assert.throws(()=>parseNiftiMask(buffer),/противоречат/);
});
test("quaternion rotation is matched in physical coordinates rather than array axis names",()=>{
  const b=fixture();const v=new DataView(b);
  v.setInt16(254,0,true);v.setInt16(252,1,true);v.setFloat32(76,1,true);v.setFloat32(264,Math.SQRT1_2,true);
  const mask=parseNiftiMask(b);
  assertMaskMatchesSource(mask,{dimensions:[3,2,2],affineLps:[0,1,0,0,-1,0,0,0,0,0,2.5,0]});
});
test("unknown geometry, template space and invalid units fail closed",()=>{
  for(const mutate of [
    (v:DataView)=>v.setInt16(254,0,true),
    (v:DataView)=>v.setInt16(254,4,true),
    (v:DataView)=>v.setUint8(123,0),
    (v:DataView)=>v.setFloat32(280,NaN,true),
  ]) { const b=fixture();mutate(new DataView(b));assert.throws(()=>parseNiftiMask(b)); }
});
test("metres are converted to millimetres before geometry matching",()=>{
  const b=fixture(); const v=new DataView(b);v.setUint8(123,1);
  for(let i=0;i<12;i++)v.setFloat32(280+i*4,v.getFloat32(280+i*4,true)/1000,true);
  const m=parseNiftiMask(b);
  assertMaskMatchesSource(m,{dimensions:[3,2,2],affineLps:AFFINE});
});
test("malformed offsets, partial pixel data, multiframe/channel masks and scaled labels are rejected",()=>{
  assert.throws(()=>parseNiftiMask(fixture().slice(0,365)),/неполные/);
  for(const mutate of [
    (v:DataView)=>v.setFloat32(108,352.5,true),
    (v:DataView)=>v.setInt16(40,4,true),
    (v:DataView)=>v.setInt16(72,32,true),
    (v:DataView)=>v.setFloat32(112,2,true),
    (v:DataView)=>v.setUint8(344,0),
    (v:DataView)=>v.setInt16(42,32767,true),
  ]) {const b=fixture();mutate(new DataView(b));assert.throws(()=>parseNiftiMask(b));}
});
test("empty label mask is retained and not mistaken for a clinical negative finding",()=>{
  assert.deepEqual(parseNiftiMask(fixture({labels:[]})).labels,[]);
});
test("too many unique labels are rejected",()=>{
  assert.throws(()=>parseNiftiMask(fixture({dimensions:[257,1,1],labels:Array.from({length:257},(_,i)=>i+1)})),/256 меток/);
});
test("source geometry comes from actual index-to-world coordinates, including oblique acquisitions",()=>{
  const affine:Affine=[Math.SQRT1_2,-Math.SQRT1_2,0,10,Math.SQRT1_2,Math.SQRT1_2,0,20,0,0,4.5,30];
  const source=sourceGeometry([3,2,2],p=>transformPoint(affine,p));
  assertMaskMatchesSource({dimensions:[3,2,2],affineLps:affine},source);
  assert.deepEqual(transformPoint(invertAffine(affine),transformPoint(affine,[1,0,1])).map(n=>Math.round(n)||0),[1,0,1]);
});
test("physical grid matching permits axis permutation and reversal",()=>{
  const source={dimensions:[3,2,2] as Point3,affineLps:AFFINE};
  const reordered={dimensions:[2,3,2] as Point3,affineLps:[0,-1,0,12,1,0,0,20,0,0,2.5,30] as Affine};
  assertMaskMatchesSource(reordered,source);
});
test("equal dimensions do not excuse wrong position, spacing, reflection or rotation",()=>{
  for(const affine of [
    [1,0,0,11,0,1,0,20,0,0,2.5,30],
    [1,0,0,10,0,1,0,20,0,0,4.5,30],
    [-1,0,0,10,0,1,0,20,0,0,2.5,30],
    [0,-1,0,10,1,0,0,20,0,0,2.5,30],
  ]) assert.throws(()=>assertMaskMatchesSource({dimensions:[3,2,2],affineLps:affine as Affine},{dimensions:[3,2,2],affineLps:AFFINE}));
});
test("small scaling error across a long extent is rejected by physical corner checks",()=>{
  const affine=[...AFFINE] as Affine;affine[0]=1.0005;
  assert.throws(()=>assertMaskMatchesSource({dimensions:[512,2,2],affineLps:affine},{dimensions:[512,2,2],affineLps:AFFINE}),/ориентация/);
});
test("overlay selects exact labels on the chosen plane and stays transparent outside bounds",()=>{
  const mask=parseNiftiMask(fixture());
  const rgba=renderMaskPlane(mask,[10,20,32.5],[1,0,0],[0,1,0],3,2,0.5,1);
  assert.deepEqual(Array.from({length:6},(_,i)=>rgba[i*4+3]),[0,128,128,0,0,0]);
  const all=renderMaskPlane(mask,[10,20,30],[1,0,0],[0,1,0],3,2,1,null);
  assert.equal(all[4*4+3],255);
  const outside=renderMaskPlane(mask,[10,20,60],[1,0,0],[0,1,0],3,2,1,null);
  assert.ok(outside.every(v=>v===0));
  assert.throws(()=>renderMaskPlane(mask,[0,0,0],[1,0,0],[0,1,0],1024,512,1,null));
});
test("overlay preserves voxel locations after a physical axis reversal",()=>{
  const reversed:Affine=[-1,0,0,12,0,1,0,20,0,0,2.5,30];
  const mask=parseNiftiMask(fixture({affine:reversed,labels:[1,0,0]}));
  assertMaskMatchesSource(mask,{dimensions:[3,2,2],affineLps:AFFINE});
  const rgba=renderMaskPlane(mask,[10,20,30],[1,0,0],[0,1,0],3,2,1,1);
  assert.deepEqual(Array.from({length:3},(_,i)=>rgba[i*4+3]),[0,0,255]);
});
test("gzipped NIfTI follows the same parser and invalid gzip does not succeed",async()=>{
  const mask=await readNiftiMaskFile(new Blob([gzipSync(new Uint8Array(fixture()))]));
  assert.equal(mask.labels[0].voxels,4);
  await assert.rejects(readNiftiMaskFile(new Blob([new Uint8Array([31,139,0,0])])));
});
test("gzip expansion is stopped at the uncompressed byte limit",async()=>{
  const compressed=gzipSync(new Uint8Array(MAX_MASK_FILE_BYTES+1));
  await assert.rejects(readNiftiMaskFile(new Blob([compressed])),/Распакованная маска/);
});
