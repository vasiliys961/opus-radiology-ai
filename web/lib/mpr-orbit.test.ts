import test from "node:test";
import assert from "node:assert/strict";
import { orbitCamera } from "./mpr-orbit.ts";
const pose={position:[0,0,10] as [number,number,number],focalPoint:[1,2,3] as [number,number,number],viewUp:[0,1,0] as [number,number,number]};
test("zero rotation preserves camera",()=>assert.deepEqual(orbitCamera(pose,0,0),pose));
test("orbit preserves camera-to-focal distance",()=>{
 const p=orbitCamera(pose,65,23),length=(v:number[])=>Math.hypot(...v);
 assert.ok(Math.abs(length(p.position.map((v,i)=>v-p.focalPoint[i]))-length(pose.position.map((v,i)=>v-pose.focalPoint[i])))<1e-9);
 assert.deepEqual(p.focalPoint,pose.focalPoint);
});
test("yaw and pitch change camera position without NaN",()=>{
 const p=orbitCamera(pose,30,10);
 assert.notDeepEqual(p.position,pose.position);assert.ok([...p.position,...p.viewUp].every(Number.isFinite));
});
test("invalid or degenerate camera does not invent position",()=>{
 assert.deepEqual(orbitCamera(pose,Number.NaN,10),pose);
 const same={...pose,position:pose.focalPoint};assert.deepEqual(orbitCamera(same,10,10),same);
});
