import test from "node:test";
import assert from "node:assert/strict";
import {parseDicomFrame,measureCtDicomCircularRoi,renderDicomPixels} from "./dicom-lite.ts";
import type {TechnicalDicomMetadata} from "./dicom-series.ts";

function syntheticCt({signed=false,highBit=15,invalidSlope=false}:{
 signed?:boolean;highBit?:number;invalidSlope?:boolean;
}={}):ArrayBuffer{
 const bytes:number[]=[...Buffer.alloc(128),...Buffer.from("DICM")];
 function add(group:number,tag:number,vr:string,body:Buffer){
   const long=vr==="OW",size=body.length+(body.length%2);
   const head=Buffer.alloc(long?12:8);
   head.writeUInt16LE(group,0);head.writeUInt16LE(tag,2);head.write(vr,4);
   if(long)head.writeUInt32LE(size,8);else head.writeUInt16LE(size,6);
   bytes.push(...head,...body,...Buffer.alloc(size-body.length));
 }
 const us=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
 add(2,0x10,"UI",Buffer.from("1.2.840.10008.1.2.1"));
 add(8,0x60,"CS",Buffer.from("CT"));
 add(0x28,2,"US",us(1));add(0x28,4,"CS",Buffer.from("MONOCHROME2"));
 add(0x28,0x10,"US",us(64));add(0x28,0x11,"US",us(64));
 add(0x28,0x100,"US",us(16));add(0x28,0x101,"US",us(signed?12:16));
 add(0x28,0x102,"US",us(highBit));
 add(0x28,0x103,"US",us(signed?1:0));
 add(0x28,0x1052,"DS",Buffer.from(signed?"0":"-1024"));
 add(0x28,0x1053,"DS",Buffer.from(invalidSlope?"0":"1"));
 add(0x28,0x1054,"LO",Buffer.from("HU"));
 const pixels=Buffer.alloc(64*64*2);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
   const inside=x>=16&&x<48&&y>=16&&y<48;
   const hu=inside?50:100;
   const raw=signed ? (inside?4096-100:100) : 1024+hu;
   pixels.writeUInt16LE(signed?raw*16**(highBit===15?1:0):raw,(y*64+x)*2);
 }
 add(0x7fe0,0x10,"OW",pixels);
 return Uint8Array.from(bytes).buffer;
}
const header:TechnicalDicomMetadata={
 sopInstanceUid:"1.2.3.4",studyUid:"1.2.3",seriesUid:"1.2.3.1",
 frameOfReferenceUid:null,modality:"CT",instanceNumber:1,numberOfFrames:1,
 rows:64,columns:64,transferSyntax:"1.2.840.10008.1.2.1",
 imagePositionPatient:[0,0,0],imageOrientationPatient:[1,0,0,0,1,0],
 pixelSpacing:[0.75,0.5],rescaleSlope:1,rescaleIntercept:-1024,rescaleUnit:"HU",
};

test("real source pixels measured in circular CT ROI and true physical area",()=>{
 const frame=parseDicomFrame(syntheticCt());
 const roi=measureCtDicomCircularRoi(frame,header,32,32,10);
 assert.equal(roi.meanHu,50);assert.equal(roi.medianHu,50);
 assert.equal(roi.p10Hu,50);assert.equal(roi.p90Hu,50);
 assert.equal(roi.stdDevHu,0);assert.equal(roi.minHu,50);
 assert.equal(roi.maxHu,50);
 assert.equal(roi.areaMm2,Math.round(roi.pixelCount*.375*100)/100);
 assert.equal(roi.histogram.reduce((sum,b)=>sum+b.count,0),roi.pixelCount);
 assert.equal(roi.rescaleType,"HU");
});
test("off-center ROI actually detects mixed source pixel HU distributions",()=>{
 const frame=parseDicomFrame(syntheticCt());
 const roi=measureCtDicomCircularRoi(frame,header,17,32,10);
 assert.ok(roi.meanHu>50&&roi.meanHu<100);
 assert.equal(roi.minHu,50);assert.equal(roi.maxHu,100);
 assert.ok(roi.stdDevHu>0);
 assert.equal(roi.histogram.reduce((sum,b)=>sum+b.count,0),roi.pixelCount);
});
test("valid DICOM negative signed stored 12-bit samples are not mistaken for 3996 HU",()=>{
 const frame=parseDicomFrame(syntheticCt({signed:true,highBit:11}));
 const roi=measureCtDicomCircularRoi(frame,{...header,rescaleIntercept:0},32,32,6);
 assert.equal(roi.meanHu,-100);
 assert.equal(roi.medianHu,-100);
});
test("left-justified signed 12-bit samples preserve the same measured HU",()=>{
 const frame=parseDicomFrame(syntheticCt({signed:true,highBit:15}));
 const roi=measureCtDicomCircularRoi(frame,{...header,rescaleIntercept:0},32,32,6);
 assert.equal(roi.meanHu,-100);
});
test("unknown, uncalibrated, wrong-modality and other DICOM types never pretend to give HU",()=>{
 const f=parseDicomFrame(syntheticCt());
 const bad=[
  {...header,modality:"MR"}, {...header,rescaleUnit:"OTHER" as const},
  {...header,rescaleUnit:"UNSPECIFIED" as const},
  {...header,rescaleSlope:null},{...header,rescaleIntercept:null},
  {...header,rescaleSlope:2},{...header,rescaleIntercept:-1000},
  {...header,pixelSpacing:null},{...header,columns:65},
 ];
 for(const h of bad)assert.throws(()=>measureCtDicomCircularRoi(f,h,32,32,8));
 assert.throws(()=>measureCtDicomCircularRoi(parseDicomFrame(syntheticCt({invalidSlope:true})),header,32,32,8));
});
test("off-image, undersized and unbounded ROI are refused, no values guessed",()=>{
 const f=parseDicomFrame(syntheticCt());
 for(const [x,y,radius] of [[1,1,8],[32,32,1],[32,32,128],[NaN,32,8],[63,0,8]])
   assert.throws(()=>measureCtDicomCircularRoi(f,header,x,y,radius));
 assert.equal(renderDicomPixels(f).length,64*64*4);
});
