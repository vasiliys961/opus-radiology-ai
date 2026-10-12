import test from "node:test";
import assert from "node:assert/strict";
import {groupDicomSeries,type TechnicalDicomMetadata} from "./dicom-series.ts";
import {fullCtGeometry,fullCtChunks,prepareFullCtStream,type PlaneReader} from "./full-ct-stream.ts";
import {fullCtNiftiHeader,scalarNiftiHeader,writeScalarNifti,sha256} from "./analysis-package.ts";

function series(rows=4,columns=6,frames=40) {
  const m:TechnicalDicomMetadata={studyUid:"2.25.1",seriesUid:"2.25.2",frameOfReferenceUid:"2.25.3",sopInstanceUid:null,
    modality:"CT",rows,columns,numberOfFrames:1,instanceNumber:null,imageOrientationPatient:[-1,0,0,0,-1,0],
    imagePositionPatient:[12,14,-40],pixelSpacing:[1,0.5],transferSyntax:"1.2.840.10008.1.2.1"};
  return groupDicomSeries(Array.from({length:frames},(_,z)=>({id:String(z),name:"nonpatient",metadata:{...m,
    sopInstanceUid:`2.25.4.${z}`,imagePositionPatient:[12,14,-40+z*2]}})))[0];
}
test("Separate full header accepts 103 native frames while all legacy full-buffer guards remain",()=>{
  const geometry=fullCtGeometry(series(512,512,103));
  assert.equal(fullCtNiftiHeader(geometry).count,512*512*103);
  assert.throws(()=>scalarNiftiHeader(geometry),/8 388 608/);
  for(const s of [series(513,512),series(512,512,301),{...series(),modality:"MR"},{...series(),volumeReady:false}])assert.throws(()=>fullCtGeometry(s));
  const jitter=series();jitter.members[20].metadata.imagePositionPatient![2]+=0.09;
  assert.throws(()=>fullCtGeometry(jitter),/сетка|сеткой/);
});
test("Full two-pass native stream equals independent scalar NIfTI with exact LPS and rescale",async()=>{
  const s=series(),geometry=fullCtGeometry(s),reads:number[]=[],released:number[]=[];
  const planeSize=24,read:PlaneReader=async(z)=>{reads.push(z);return{values:Float32Array.from({length:planeSize},(_,i)=>z*100+i/2),
    slope:2,intercept:-1024,release:()=>released.push(z)};};
  const packet=await prepareFullCtStream(s,read,new AbortController().signal);
  const expected=await writeScalarNifti(geometry,i=>Math.floor(i/24)*200+(i%24)-1024);
  assert.equal(packet.request.schema,"opus-analysis-request/v2");assert.equal(packet.request.frameCount,40);
  assert.equal(packet.request.inputSha256,await sha256(expected));assert.equal(packet.byteLength,expected.byteLength);
  const out=new Uint8Array(packet.byteLength);let offset=0;
  for await(const chunk of packet.chunks(new AbortController().signal)){assert.ok(chunk.byteLength<=131072);out.set(new Uint8Array(chunk),offset);offset+=chunk.byteLength;}
  assert.deepEqual(out,new Uint8Array(expected));assert.equal(reads.length,80);assert.deepEqual(reads,released);
  assert.equal(Object.hasOwn(packet,"buffer"),false);assert.equal(packet.request.coverage,"not-confirmed");
});
test("Backpressure, early return and cancellation release the only owned plane; corrupt values fail",async()=>{
  let reads=0,releases=0;const geometry=fullCtGeometry(series(512,512,3));
  const read:PlaneReader=async()=>{reads++;return{values:new Int16Array(512*512),slope:1,intercept:-1024,release:()=>{releases++;}};};
  const chunks=fullCtChunks(geometry,read,new AbortController().signal);
  await chunks.next();assert.equal(reads,0);await chunks.next();assert.equal(reads,1);assert.equal(releases,0);
  await chunks.return(undefined);assert.equal(releases,1);assert.equal(reads,1);
  const controller=new AbortController(),cancelled=fullCtChunks(geometry,read,controller.signal);
  await cancelled.next();controller.abort();await assert.rejects(cancelled.next(),/закрыта/);assert.equal(reads,1);
  const invalid=fullCtChunks(fullCtGeometry(series()),async()=>({values:[NaN],slope:1,intercept:0,release:()=>{releases++;}}),new AbortController().signal);
  await invalid.next();await assert.rejects(invalid.next(),/скаляры/);assert.equal(releases,2);
});
