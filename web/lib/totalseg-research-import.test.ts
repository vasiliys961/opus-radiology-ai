import test from "node:test";
import assert from "node:assert/strict";
import {parseResearchLobes} from "./totalseg-research-import.ts";
import type {LabelMask} from "./segmentation-mask.ts";

const SHA="a".repeat(64);
const mask={dimensions:[4,3,2],labels:[{id:10,voxels:10,volumeMl:0.01},{id:12,voxels:5,volumeMl:0.005}]} as LabelMask;
const fixture=()=>({
  schema:"opus-totalseg-native-mpr-slab/v1",
  sourceGridGeometry:"native_contiguous_unresampled",clinicalStatus:"not_validated",
  readyForClinicalUse:false,fullAnatomicCoverageVerified:false,
  sourceFullCtSha256:"b".repeat(64),sourceFullMaskSha256:"c".repeat(64),
  slabMaskSha256:SHA,sourceDimensions:[4,3,103],slabDimensions:[4,3,2],
  firstOriginalSliceIndexZeroBased:35,lastOriginalSliceIndexZeroBased:36,
  labelVoxels:[{id:10,voxels:10},{id:11,voxels:0},{id:12,voxels:5},{id:13,voxels:0},{id:14,voxels:0}],
});

test("anatomical labels and missing-class QC require checksum-matched five-lobe manifest",()=>{
  const research=parseResearchLobes(JSON.stringify(fixture()),mask,SHA);
  assert.deepEqual(research.missingLabels,[11,13,14]);
  assert.equal(research.labelNames[12],"Правое лёгкое · верхняя доля");
  assert.equal(research.firstSlice,35);
  assert.equal(research.status,"not_validated");
});
test("mismatched checksum, source slice coverage, label counts and unsupported claims reject",()=>{
  const cases=[
    {slabMaskSha256:"f".repeat(64)},
    {readyForClinicalUse:true},
    {clinicalStatus:"validated"},
    {sourceGridGeometry:"resampled"},
    {sourceDimensions:[4,3,1]},
    {slabDimensions:[4,3,3]},
    {lastOriginalSliceIndexZeroBased:102},
    {labelVoxels:[{id:10,voxels:10}]},
    {labelVoxels:[{id:10,voxels:9},...fixture().labelVoxels.slice(1)]},
    {labelVoxels:[...fixture().labelVoxels.slice(0,4),{id:99,voxels:0}]},
  ];
  for(const change of cases){
    assert.throws(()=>parseResearchLobes(JSON.stringify({...fixture(),...change}),mask,SHA));
  }
  assert.throws(()=>parseResearchLobes(JSON.stringify(fixture()),mask,"f".repeat(64)));
  assert.throws(()=>parseResearchLobes("{",mask,SHA));
  assert.throws(()=>parseResearchLobes("x".repeat(65537),mask,SHA));
});
test("bare numeric labels are never given a model-specific meaning",()=>{
  assert.throws(()=>parseResearchLobes(JSON.stringify(fixture()),{
    ...mask,labels:[{id:99,voxels:5,volumeMl:0.005}],
  } as LabelMask,SHA));
});
