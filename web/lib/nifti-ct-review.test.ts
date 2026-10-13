import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readNiftiCtHeader,verifyNiftiCtSource,loadNativeCtSlab,
  assertSameNativeIndexGrid,renderNativeCtPlane} from "./nifti-ct-review.ts";
import type {AnatomyProof} from "./totalseg-abdomen-import.ts";
import type {LabelMask} from "./segmentation-mask.ts";

function fixture(){
  const header=new ArrayBuffer(352),v=new DataView(header);
  v.setInt32(0,348,true);v.setInt16(40,3,true);
  for(const [i,n] of [4,3,5].entries())v.setInt16(42+2*i,n,true);
  for(let i=48;i<=54;i+=2)v.setInt16(i,1,true);
  v.setInt16(70,16,true);v.setInt16(72,32,true);
  v.setFloat32(108,352,true);v.setUint8(123,2);
  v.setInt16(254,1,true);v.setInt16(252,0,true);
  const ras=[-1,0,0,-10,0,-2,0,-20,0,0,3,30];
  ras.forEach((x,i)=>v.setFloat32(280+4*i,x,true));
  [110,43,49,0].forEach((x,i)=>v.setUint8(344+i,x));
  const values=new Float32Array(4*3*5);
  for(let z=0;z<5;z++)for(let y=0;y<3;y++)for(let x=0;x<4;x++)
    values[x+4*(y+3*z)]=z*100+y*10+x;
  const raw=new Uint8Array(352+values.byteLength);
  raw.set(new Uint8Array(header));
  raw.set(new Uint8Array(values.buffer),352);
  const sha=createHash("sha256").update(raw).digest("hex");
  const file=new Blob([raw]);
  const proof={
    anatomy:"abdomen",sourceSha256:sha,maskSha256:"a".repeat(64),
    firstSlice:1,lastSlice:2,fullDimensions:[4,3,5],
    labelNames:{1:"Селезёнка",2:"Правая почка",3:"Левая почка",5:"Печень"},
    missingLabels:[2,3,5],status:"not_validated",
  } as AnatomyProof;
  const data=new Uint16Array(4*3*2);
  data[0]=1;
  const mask:LabelMask={
    data,dimensions:[4,3,2],
    affineLps:[1,0,0,10,0,2,0,20,0,0,3,33],
    inverseLps:[1,0,0,-10,0,0.5,0,-10,0,0,1/3,-11],
    voxelVolumeMm3:6,labels:[{id:1,voxels:1,volumeMl:0.006}],
  };
  return {file,proof,mask,raw};
}
test("strict CT header and local incremental exact SHA; never fetch source over network",async()=>{
  const f=fixture();
  const meta=await readNiftiCtHeader(f.file);
  assert.deepEqual(meta.dimensions,[4,3,5]);
  assert.deepEqual(meta.affineLps,[1,0,0,10,0,2,0,20,0,0,3,30]);
  assert.equal(meta.bytesPerVoxel,4);
  await verifyNiftiCtSource(f.file,f.proof.sourceSha256);
  await assert.rejects(()=>verifyNiftiCtSource(f.file,"b".repeat(64)),/SHA-256/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(()=>verifyNiftiCtSource(f.file,f.proof.sourceSha256,abort.signal),/отменена/);
});
test("extract exactly the requested original NIfTI slab with correct sform shift",async()=>{
  const f=fixture(),header=await readNiftiCtHeader(f.file);
  const slab=await loadNativeCtSlab(f.file,header,f.proof);
  assert.deepEqual(slab.dimensions,[4,3,2]);
  assert.deepEqual(slab.sourceRange,[1,2]);
  assert.equal(slab.pixels.length,24);
  assert.equal(slab.pixels[0],100);
  assert.equal(slab.pixels[12],200);
  assert.deepEqual(slab.affineLps,[1,0,0,10,0,2,0,20,0,0,3,33]);
  assert.doesNotThrow(()=>assertSameNativeIndexGrid(slab,f.mask));
});
test("native K/J/I planes share source voxel indices with selected mask overlays",async()=>{
  const f=fixture(),slab=await loadNativeCtSlab(f.file,await readNiftiCtHeader(f.file),f.proof);
  const raw=renderNativeCtPlane(slab,"k",0,4,3,100,200);
  assert.equal(raw.length,4*3*4);
  assert.deepEqual(Array.from(raw.slice(0,4)),[128,128,128,255]);
  const overlay=renderNativeCtPlane(slab,"k",0,4,3,100,200,f.mask,1,0.8);
  assert.equal(overlay[3],255);
  assert.notDeepEqual(Array.from(overlay.slice(0,3)),Array.from(raw.slice(0,3)));
  const other=renderNativeCtPlane(slab,"k",1,4,3,100,200,f.mask,1,0.8);
  assert.deepEqual(Array.from(other.slice(0,3)),Array.from(
    renderNativeCtPlane(slab,"k",1,4,3,100,200).slice(0,3)));
  for(const p of ["i","j"] as const)assert.equal(renderNativeCtPlane(slab,p,0,4,3,100,200,f.mask).length,48);
});
test("rejects native reversed/reordered grid, even when bounding corners could match",async()=>{
  const f=fixture(),slab=await loadNativeCtSlab(f.file,await readNiftiCtHeader(f.file),f.proof);
  const inverse={...f.mask,affineLps:[-1,0,0,13,0,2,0,20,0,0,3,33] as LabelMask["affineLps"]};
  assert.throws(()=>assertSameNativeIndexGrid(slab,inverse),/Порядок индексов/);
  const translated={...f.mask,affineLps:[1,0,0,20,0,2,0,20,0,0,3,33] as LabelMask["affineLps"]};
  assert.throws(()=>assertSameNativeIndexGrid(slab,translated),/совпадает/);
});
test("rejected unverified units, four-dimensional files and bad source SHA",async()=>{
  const f=fixture();
  const malformed=(edit:(v:DataView)=>void)=>{
    const b=f.raw.slice();edit(new DataView(b.buffer));return new Blob([b]);
  };
  await assert.rejects(()=>readNiftiCtHeader(malformed(v=>v.setUint8(123,0))),/миллиметрах/);
  await assert.rejects(()=>readNiftiCtHeader(malformed(v=>v.setInt16(40,4,true))),/трёхмерная/);
  await assert.rejects(()=>readNiftiCtHeader(malformed(v=>v.setInt16(254,0,true))),/sform/);
  await assert.rejects(()=>readNiftiCtHeader(malformed(v=>v.setFloat32(108,800,true))),/offset/);
  await assert.rejects(()=>readNiftiCtHeader(malformed(v=>v.setInt16(70,2,true))),/float32/);
  const h=await readNiftiCtHeader(f.file);
  await assert.rejects(()=>loadNativeCtSlab(f.file,h,{...f.proof,sourceSha256:"d".repeat(64)}),/SHA-256/);
  await assert.rejects(()=>loadNativeCtSlab(f.file,h,{...f.proof,firstSlice:0,lastSlice:40}),/ограниченный/);
});
