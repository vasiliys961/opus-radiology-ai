import test from "node:test";
import assert from "node:assert/strict";
import {readNativeIchKSlice} from "./ich-native-slice.ts";

const dims=[16,16,16] as const;
const affine=[[1,0,0,10],[0,1,0,20],[0,0,2,30],[0,0,0,1]];
function makeNii(kind:"ct"|"mask"|"expert",badAffine=false,nonbinary=false):Blob{
 const bytes=kind==="ct"||kind==="expert"?2:1,count=dims[0]*dims[1]*dims[2];
 const b=new ArrayBuffer(352+bytes*count);
 const v=new DataView(b);
 v.setInt32(0,348,true);
 v.setInt16(40,3,true);
 for(let i=0;i<3;i++)v.setInt16(42+2*i,dims[i],true);
 for(const i of [48,50,52,54])v.setInt16(i,1,true);
 v.setInt16(70,kind==="ct"?4:kind==="expert"?512:2,true);
 v.setInt16(72,bytes*8,true);
 v.setFloat32(108,352,true);
 v.setFloat32(112,NaN,true);
 v.setFloat32(116,NaN,true);
 v.setUint8(123,2);
 v.setInt16(254,2,true);
 for(let row=0;row<3;row++)for(let col=0;col<4;col++)
   v.setFloat32(280+(row*4+col)*4,badAffine&&row===0&&col===3?11:affine[row][col],true);
 [110,43,49,0].forEach((x,i)=>v.setUint8(344+i,x));
 for(let i=0;i<count;i++){
  if(kind==="ct")v.setInt16(352+i*2,i%1024-300,true);
  else if(kind==="expert")v.setUint16(352+i*2,i===600?2:i===601?3:0,true);
  else v.setUint8(352+i,nonbinary&&i===600?2:i===600?1:0);
 }
 return new Blob([b]);
}
test("reads one native CT index-k plane, not the entire study",async()=>{
 const slice=await readNativeIchKSlice(makeNii("ct"),"ct",2,dims,affine);
 assert.deepEqual(slice.dimensions,[16,16]);
 assert.equal(slice.pixels.length,256);
 assert.equal(slice.pixels[0],(512%1024)-300);
 assert.equal(slice.nativeIndexOrder,true);
});
test("reads binary trained mask and rejects unknown labels",async()=>{
 const slice=await readNativeIchKSlice(makeNii("mask"),"mask",2,dims,affine);
 assert.equal(slice.pixels.length,256);
 assert.equal(slice.pixels[88],1); // index 600 - 512
 await assert.rejects(readNativeIchKSlice(makeNii("mask",false,true),
   "mask",2,dims,affine),/вне 0\/1/);
});
test("wrong source orientation, dimensions and slice bounds fail closed",async()=>{
 await assert.rejects(readNativeIchKSlice(makeNii("ct",true),
   "ct",2,dims,affine),/Sform/);
 await assert.rejects(readNativeIchKSlice(makeNii("ct"),
   "ct",2,[16,17,16],affine),/размеры/);
 await assert.rejects(readNativeIchKSlice(makeNii("ct"),
   "ct",19,dims,affine),/диапазона/);
});

test("expert label map allows selected uint16 expert class without treating other classes as model positives",async()=>{
 const data=await readNativeIchKSlice(makeNii("expert"),"expert",2,dims,affine,undefined,2);
 assert.equal(data.pixels[88],1);
 assert.equal(data.pixels[89],0);
 await assert.rejects(readNativeIchKSlice(makeNii("expert"),"expert",
   2,dims,affine,undefined,0),/метка/);
 await assert.rejects(readNativeIchKSlice(makeNii("expert"),"expert",
   2,dims,affine),/метка/);
});
