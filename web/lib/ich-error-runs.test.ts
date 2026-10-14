import test from "node:test";
import assert from "node:assert/strict";
import {contiguousIchErrorRuns} from "./ich-error-runs.ts";
import type {IchSliceEvidenceRow} from "./ich-slice-evidence";

function row(i:number,fn:number,fp:number):IchSliceEvidenceRow{
 return {nativeSliceIndex:i,predictedVoxels:fp,expertVoxels:fn,
  overlapVoxels:0,falseNegativeVoxels:fn,falsePositiveVoxels:fp,
  sliceDice:fn+fp?0:null};
}
test("groups adjacent missed slices, ranks by total FN, navigates to peak",()=>{
 const rows=[row(0,4,0),row(1,6,0),row(2,0,3),row(3,8,1),
  row(4,8,1),row(5,1,0)];
 const runs=contiguousIchErrorRuns(rows,"fn");
 assert.equal(runs.length,2);
 assert.deepEqual(runs[0],{
  firstSliceIndex:3,lastSliceIndex:5,sliceCount:3,
  totalUnmatchedVoxels:17,peakSliceIndex:3,peakSliceUnmatchedVoxels:8});
 assert.equal(runs[1].totalUnmatchedVoxels,10);
 assert.equal(contiguousIchErrorRuns(rows,"fp").length,1);
});
test("does not invent lesion runs for empty error masks and refuses unordered indices",()=>{
 assert.deepEqual(contiguousIchErrorRuns([row(0,0,0)],"fn"),[]);
 assert.throws(()=>contiguousIchErrorRuns([row(1,4,0)],"fn"),/Unordered/);
});
