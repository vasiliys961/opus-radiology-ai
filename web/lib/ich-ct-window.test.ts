import test from "node:test";
import assert from "node:assert/strict";
import {automaticCtWindow,grayscaleCt} from "./ich-ct-window.ts";

test("normalized CT pixels stay visible without claiming HU",()=>{
 const values=new Float32Array(512);
 for(let i=0;i<values.length;i++) values[i]=i/(values.length-1);
 const w=automaticCtWindow(values);
 assert.equal(w.mode,"auto");
 assert.ok(w.center>0.45&&w.center<0.55);
 assert.ok(grayscaleCt(.1,w)>0);
 assert.ok(grayscaleCt(.9,w)<255);
 assert.ok(grayscaleCt(.9,w)>grayscaleCt(.1,w));
});
test("signed HU CT uses fixed brain window or adaptive viewer",()=>{
 const w={center:40,width:80};
 assert.equal(grayscaleCt(0,w),0);
 assert.equal(grayscaleCt(40,w),128);
 assert.equal(grayscaleCt(80,w),255);
 assert.ok(automaticCtWindow(Float32Array.from([-20,0,10,40,80,120])).width>0);
});
test("constant skull-stripped source never divides by zero",()=>{
 const w=automaticCtWindow(new Float32Array(500));
 assert.equal(w.width,1);
 assert.ok(Number.isFinite(grayscaleCt(0,w)));
});
test("non-finite pixels and excessive slice are rejected",()=>{
 assert.throws(()=>automaticCtWindow(Float32Array.from([1,NaN])));
 assert.throws(()=>automaticCtWindow(new Float32Array(512*512+1)));
});
