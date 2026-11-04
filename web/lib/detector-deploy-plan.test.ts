import test from "node:test";
import assert from "node:assert/strict";
import {planDetectorDeploy,DETECTOR_DEPLOY_MINIMUM,NOT_DEPLOYED} from "./detector-deploy-plan.ts";
const GiB=1024**3;
test("a Mac never receives a detector download",()=>{
  for(const scope of ["basic","full"] as const){
    const plan=planDetectorDeploy({platform:"darwin",ramBytes:64*GiB,freeDiskBytes:200*GiB},scope);
    assert.equal(plan.eligible,false);
    assert.equal(plan.reason,"mac");
    assert.deepEqual(plan.installs,[]);
    assert.equal(plan.items.every(item=>item.willInstall===false),true);
  }
});
test("Linux below 16 GiB or 30 GiB free does not download",()=>{
  assert.equal(planDetectorDeploy({platform:"linux",ramBytes:8*GiB,freeDiskBytes:80*GiB}).reason,"ram");
  assert.equal(planDetectorDeploy({platform:"linux",ramBytes:32*GiB,freeDiskBytes:10*GiB}).reason,"disk");
  assert.equal(DETECTOR_DEPLOY_MINIMUM.ramGib,16);
  assert.equal(DETECTOR_DEPLOY_MINIMUM.freeDiskGib,30);
});
test("the first button installs only the chest radiograph weights",()=>{
  const plan=planDetectorDeploy({platform:"linux",ramBytes:16*GiB,freeDiskBytes:30*GiB},"basic");
  assert.equal(plan.eligible,true);
  assert.deepEqual(plan.installs,["chest_xray_six"]);
  assert.match(plan.items[0].size,/10 до 90 МБ/);
  assert.match(plan.items[0].requirement,/16 ГБ/);
});
test("the full button lists pinned weights and keeps the lung tumor behind 64 GiB",()=>{
  const small=planDetectorDeploy({platform:"linux",ramBytes:16*GiB,freeDiskBytes:30*GiB},"full");
  assert.deepEqual(small.installs,["chest_xray_six","chest_nodes","lungmask_r231","lung_nodules","brain_hemorrhage",
    "chest_effusion","abdomen_ct","brain_wmh","chest_pe"]);
  assert.match(small.items.find(item=>item.id==="lung_nodules")?.size??"",/83 709 381/);
  assert.match(small.items.find(item=>item.id==="chest_effusion")?.size??"",/233 744 954/);
  assert.match(small.items.find(item=>item.id==="abdomen_ct")?.size??"",/230 940 114/);
  assert.match(small.items.find(item=>item.id==="brain_wmh")?.size??"",/246 100 637/);
  assert.match(small.items.find(item=>item.id==="chest_pe")?.size??"",/566 265 379/);
  const tumor=small.items.find(item=>item.id==="lung_tumor_cln");
  assert.equal(tumor?.willInstall,false);
  assert.match(tumor?.requirement??"",/64 ГБ/);
  assert.match(tumor?.size??"",/400 МБ/);
  const large=planDetectorDeploy({platform:"linux",ramBytes:64*GiB,freeDiskBytes:30*GiB},"full");
  assert.equal(large.items.find(item=>item.id==="lung_tumor_cln")?.willInstall,true);
  assert.match(small.items.find(item=>item.id==="chest_nodes")?.size??"",/105 186 900/);
  assert.match(small.items.find(item=>item.id==="brain_hemorrhage")?.size??"",/161 042 978/);
  assert.match(NOT_DEPLOYED,/Инсульт и глиома/);
  assert.match(NOT_DEPLOYED,/не исключает эмболию/);
  assert.doesNotMatch(NOT_DEPLOYED,/Выпот, живот/);
});
