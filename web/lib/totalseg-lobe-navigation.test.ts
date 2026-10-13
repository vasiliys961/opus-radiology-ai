import test from "node:test";
import assert from "node:assert/strict";
import {buildResearchLobeRegions} from "./totalseg-lobe-navigation.ts";
import type {LabelMask} from "./segmentation-mask.ts";
import type {ResearchLobes} from "./totalseg-research-import.ts";
const proof={
  sourceSha256:"a".repeat(64),maskSha256:"b".repeat(64),
  firstSlice:35,lastSlice:36,fullDimensions:[3,3,103],
  labelNames:{10:"Левое верхнее",11:"Левое нижнее",12:"Правое верхнее",13:"Правое среднее",14:"Правое нижнее"},
  missingLabels:[11,13,14],status:"not_validated",
} as ResearchLobes;
function fixture():LabelMask{
  // 3x3x2; three adjacent voxels of id 10, one voxel of id 12.
  const data=new Uint16Array(18);
  data[0]=10;data[1]=10;data[3]=10;data[17]=12;
  return {dimensions:[3,3,2],affineLps:[1,0,0,10,0,2,0,20,0,0,3,30],
    inverseLps:[1,0,0,-10,0,0.5,0,-10,0,0,1/3,-10],
    data,voxelVolumeMm3:6,
    labels:[{id:10,voxels:3,volumeMl:0.018},{id:12,voxels:1,volumeMl:0.006}]};
}
const options={yieldControl:async()=>{}};
test("computed label anchors always fall inside the model label, not empty space",async()=>{
  const mask=fixture();
  const regions=await buildResearchLobeRegions(mask,proof,options);
  assert.deepEqual(regions.map(x=>x.id),[10,12]);
  for(const region of regions){
    const [x,y,z]=region.anchorMaskIndex;
    assert.equal(mask.data[x+3*y+9*z],region.id);
    assert.equal(region.status,"unverified_research");
  }
  assert.deepEqual(regions[0].boundsMaskIndex,{min:[0,0,0],max:[1,1,0]});
  assert.deepEqual(regions[0].originalSliceRange,[35,35]);
  assert.deepEqual(regions[1].originalSliceRange,[36,36]);
  assert.deepEqual(regions[1].anchorLpsMm,[12,24,33]);
  assert.equal(regions[0].volumeMl,0.018);
});
test("rejects unexpected labels and tampered label counts",async()=>{
  const mask=fixture();mask.data[17]=99;
  await assert.rejects(()=>buildResearchLobeRegions(mask,proof,options),/неизвестная/);
  const changed=fixture();changed.labels[0].voxels=1;
  await assert.rejects(()=>buildResearchLobeRegions(changed,proof,options),/изменились/);
});
test("stale async label scan stops if user changes the series",async()=>{
  const mask=fixture();
  let cancelled=false;
  await assert.rejects(()=>buildResearchLobeRegions(mask,proof,{
    cancelled:()=>cancelled,
    yieldControl:async()=>{cancelled=true;},
  }),/отменена/);
});
test("source range and bounds must match the actual mask",async()=>{
  const mask=fixture();
  await assert.rejects(()=>buildResearchLobeRegions(mask,{...proof,lastSlice:39},options),/Неверный размер/);
  const broken=fixture();broken.data=new Uint16Array(2);
  await assert.rejects(()=>buildResearchLobeRegions(broken,proof,options),/Неверный размер/);
});
