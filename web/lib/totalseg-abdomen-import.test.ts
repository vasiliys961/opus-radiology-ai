import test from "node:test";
import assert from "node:assert/strict";
import {parseResearchAbdomen,parseResearchAnatomy,ABDOMEN_NAMES} from "./totalseg-abdomen-import.ts";
import {buildResearchAnatomyRegions} from "./totalseg-lobe-navigation.ts";
import type {LabelMask} from "./segmentation-mask.ts";

const MASK_SHA="a".repeat(64);
const SOURCE_SHA="b".repeat(64);
const FULL_SHA="c".repeat(64);
function mask():LabelMask{
  const data=new Uint16Array(18);
  data[0]=1;data[1]=1;data[3]=1;
  data[5]=2;data[14]=3;data[17]=5;
  return {
    data,dimensions:[3,3,2],
    affineLps:[1,0,0,10,0,2,0,20,0,0,3,30],
    inverseLps:[1,0,0,-10,0,0.5,0,-10,0,0,1/3,-10],
    voxelVolumeMm3:6,
    labels:[{id:1,voxels:3,volumeMl:0.018},
      {id:2,voxels:1,volumeMl:0.006},
      {id:3,voxels:1,volumeMl:0.006},
      {id:5,voxels:1,volumeMl:0.006}],
  };
}
const manifest=()=>({
  schema:"opus-totalseg-abdomen-native-mpr-slab/v1",
  researchProfile:"abdomen-four-organs",
  sourceGridGeometry:"native_contiguous_unresampled",
  clinicalStatus:"not_validated",
  readyForClinicalUse:false,fullAnatomicCoverageVerified:false,
  sourceFullCtSha256:SOURCE_SHA,
  sourceFullMaskSha256:FULL_SHA,
  slabMaskSha256:MASK_SHA,
  sourceDimensions:[3,3,90],slabDimensions:[3,3,2],
  firstOriginalSliceIndexZeroBased:25,lastOriginalSliceIndexZeroBased:26,
  labelVoxels:[{id:1,voxels:3},{id:2,voxels:1},{id:3,voxels:1},{id:5,voxels:1}],
});
const fast={yieldControl:async()=>{}};
test("strict four-organ parser and real occupied voxel navigation",async()=>{
  const m=mask();
  const proof=parseResearchAnatomy(JSON.stringify(manifest()),m,MASK_SHA);
  assert.equal(proof.anatomy,"abdomen");
  assert.equal(proof.labelNames[1],"Селезёнка");
  assert.equal(proof.labelNames[5],"Печень");
  assert.equal(proof.missingLabels.length,0);
  const regions=await buildResearchAnatomyRegions(m,proof,fast);
  assert.deepEqual(regions.map(r=>r.id),[1,2,3,5]);
  assert.equal(regions[0].volumeMl,0.018);
  assert.deepEqual(regions[0].originalSliceRange,[25,25]);
  assert.deepEqual(regions[3].originalSliceRange,[26,26]);
  for(const item of regions){
    const [x,y,z]=item.anchorMaskIndex;
    assert.equal(m.data[x+3*y+9*z],item.id);
    assert.equal(item.status,"unverified_research");
    assert.equal(item.name,ABDOMEN_NAMES[item.id]);
  }
});
test("unlabeled kidney is a warning, not an invented normal finding",async()=>{
  const m=mask();m.data[5]=0;m.labels=m.labels.filter(l=>l.id!==2);
  const x=manifest();x.labelVoxels[1].voxels=0;
  const proof=parseResearchAbdomen(JSON.stringify(x),m,MASK_SHA);
  assert.deepEqual(proof.missingLabels,[2]);
  assert.deepEqual((await buildResearchAnatomyRegions(m,proof,fast)).map(r=>r.id),[1,3,5]);
});
test("bad profile, schema, slice binding, counts, units, or digest fail closed",()=>{
  const invalids=[
    {schema:"opus-totalseg-native-mpr-slab/v1"},
    {researchProfile:"lung-lobes"},
    {sourceGridGeometry:"resampled"},
    {clinicalStatus:"validated"},
    {readyForClinicalUse:true},
    {fullAnatomicCoverageVerified:true},
    {sourceFullMaskSha256:"changed"},
    {slabMaskSha256:"f".repeat(64)},
    {sourceDimensions:[3,3,1]},
    {slabDimensions:[3,3,3]},
    {firstOriginalSliceIndexZeroBased:90},
    {lastOriginalSliceIndexZeroBased:99},
    {labelVoxels:manifest().labelVoxels.slice(1)},
    {labelVoxels:[{id:1,voxels:2},...manifest().labelVoxels.slice(1)]},
    {labelVoxels:[...manifest().labelVoxels.slice(0,3),{id:10,voxels:1}]},
  ];
  for(const change of invalids)assert.throws(()=>
    parseResearchAbdomen(JSON.stringify({...manifest(),...change}),mask(),MASK_SHA));
  assert.throws(()=>parseResearchAnatomy(JSON.stringify(manifest()),mask(),"f".repeat(64)));
  assert.throws(()=>parseResearchAnatomy("{}",mask(),MASK_SHA));
  assert.throws(()=>parseResearchAnatomy("{",mask(),MASK_SHA));
  assert.throws(()=>parseResearchAnatomy("x".repeat(65537),mask(),MASK_SHA));
  assert.throws(()=>parseResearchAnatomy(JSON.stringify(manifest()),{
    ...mask(),voxelVolumeMm3:0,
  },MASK_SHA));
  const unexpected=mask();unexpected.data[5]=10;unexpected.labels[1].id=10;
  assert.throws(()=>parseResearchAnatomy(JSON.stringify(manifest()),unexpected,MASK_SHA));
});
test("legacy lung manifest still uses existing five lobe schema and names",()=>{
  const m=mask();
  const lung={...manifest(),schema:"opus-totalseg-native-mpr-slab/v1",
    labelVoxels:[10,11,12,13,14].map((id)=>({id,voxels:id===10?1:0}))};
  assert.throws(()=>parseResearchAnatomy(JSON.stringify(lung),m,MASK_SHA));
});
