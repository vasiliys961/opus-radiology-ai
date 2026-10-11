import test from "node:test";
import assert from "node:assert/strict";
import { prepareAnalysisStream, scalarNiftiChunks, SCALAR_CHUNK_VOXELS } from "./analysis-stream.ts";
import { sha256, writeScalarNifti } from "./analysis-package.ts";
import type { MaskGeometry } from "./segmentation-mask.ts";
import type { DicomSeries } from "./dicom-series.ts";

const geometry: MaskGeometry={dimensions:[257,257,3],affineLps:[0,-2,0,30,1,0,0,20,0,0,-4,-10]};
const signal=()=>new AbortController().signal;
const scalar=(i:number)=>-1024.25+i/100;
const series: DicomSeries={key:"synthetic",label:"synthetic",modality:"CT",spatiallySorted:true,volumeReady:true,sliceSpacingMm:4,warning:null,
  members:[1,2,3].map(i=>({id:String(i),name:"synthetic",metadata:{studyUid:"2.25.10",seriesUid:"2.25.20",frameOfReferenceUid:"2.25.30",sopInstanceUid:`2.25.40.${i}`,
    modality:"CT",numberOfFrames:1,instanceNumber:i,rows:257,columns:257,imagePositionPatient:null,imageOrientationPatient:null,pixelSpacing:[1,2],transferSyntax:"1.2.840.10008.1.2.1"}}))};

test("chunk bytes and incremental digest equal full export for oblique negative LPS and fractional HU",async()=>{
  const full=await writeScalarNifti(geometry,scalar), stream=await prepareAnalysisStream(series,geometry,scalar,signal());
  assert.equal("buffer" in stream,false);
  assert.equal(stream.request.inputSha256,await sha256(full));
  const target=new Uint8Array(stream.byteLength);let offset=0;
  for await(const chunk of stream.chunks(signal())) {
    assert.ok(chunk.byteLength<=SCALAR_CHUNK_VOXELS*4);
    target.set(new Uint8Array(chunk),offset);offset+=chunk.byteLength;
  }
  assert.equal(offset,full.byteLength);assert.deepEqual(target,new Uint8Array(full));
});

test("producer reads no further scalars until the consumer requests another block",async()=>{
  let reads=0;
  const chunks=scalarNiftiChunks(geometry,()=>{reads++;return 1;},signal(),async()=>{});
  assert.equal((await chunks.next()).value?.byteLength,352);assert.equal(reads,0);
  await chunks.next();assert.equal(reads,SCALAR_CHUNK_VOXELS);
  await Promise.resolve();assert.equal(reads,SCALAR_CHUNK_VOXELS);
  await chunks.return(undefined);assert.equal(reads,SCALAR_CHUNK_VOXELS);
});

test("maximum supported input is produced with at most 128 KiB per scalar block",async()=>{
  let bytes=0,largest=0,reads=0;
  for await(const chunk of scalarNiftiChunks({...geometry,dimensions:[512,512,32]},()=>{reads++;return -1000;},signal(),async()=>{})) {
    bytes+=chunk.byteLength;largest=Math.max(largest,chunk.byteLength);
  }
  assert.equal(reads,8388608);assert.equal(bytes,352+8388608*4);assert.equal(largest,131072);
});

test("stream rejects oversized volume before scalar reads and stops on cancellation between blocks",async()=>{
  let reads=0;const value=()=>{reads++;return 1;};
  await assert.rejects(async()=>{for await(const chunk of scalarNiftiChunks({...geometry,dimensions:[512,512,33]},value,signal()))void chunk;},/8 388/);
  assert.equal(reads,0);
  const controller=new AbortController(), chunks=scalarNiftiChunks(geometry,value,controller.signal);
  await chunks.next();await chunks.next();controller.abort();
  await assert.rejects(chunks.next(),{name:"AbortError"});assert.equal(reads,SCALAR_CHUNK_VOXELS);
  await assert.rejects(prepareAnalysisStream(series,{...geometry,dimensions:[257,257,4]},value,signal()),/все кадры/);
});
