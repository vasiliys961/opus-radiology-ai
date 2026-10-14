import test from "node:test";
import assert from "node:assert/strict";
import {buildSmallMissLocalReview} from "./ich-small-miss-review.ts";
import type {IchComponentEvidence} from "./ich-component-evidence";

const fixture={
 clinicalValidation:false,
 evidenceHashes:{
   sourceSha256:"a".repeat(64),predictionSha256:"b".repeat(64),
   expertMaskSha256:"c".repeat(64)
 },
 referenceLabel:1,
 componentEvidence:{submilliliterReviewCandidates:[
   {componentIndex:7,volumeMl:.018,voxelCount:9,overlapVoxels:0,
    reviewSliceIndexK:4,boundsVoxelMin:[1,1,3],boundsVoxelMax:[4,4,5]},
   {componentIndex:8,volumeMl:.020,voxelCount:10,overlapVoxels:3,
    reviewSliceIndexK:6,boundsVoxelMin:[1,1,6],boundsVoxelMax:[5,5,8]}
 ]}
} as IchComponentEvidence;
const at="2026-10-14T11:22:00.000Z";

test("exports only reviewed source-bound small FN components, without pixels",()=>{
 const data=buildSmallMissLocalReview(fixture,{
   7:{status:"supports_expert_mark",note:"Needs original-slice visual review"},
 },at);
 assert.equal(data.createdAt,at);
 assert.equal(data.evidenceHashes.expertMaskSha256,"c".repeat(64));
 assert.equal(data.reviewerIdentityVerified,false);
 assert.equal(data.clinicalValidation,false);
 assert.deepEqual(data.entries.map(x=>x.componentIndex),[7]);
 assert.equal(data.entries[0].nativeNiftiSliceK,4);
 assert.equal(data.entries[0].missedExpertVoxels,9);
 assert.equal(JSON.stringify(data).includes("base64"),false);
});
test("rejects fabricated indices and status, unsigned blank disputed notes",()=>{
 assert.throws(()=>buildSmallMissLocalReview(fixture,{},at),/Нет оценённых/);
 assert.throws(()=>buildSmallMissLocalReview(fixture,{
   13:{status:"recheck",note:""}
 },at),/неизвестной/);
 assert.throws(()=>buildSmallMissLocalReview(fixture,{
   7:{status:"disputes_expert_mark",note:""}
 },at),/Недопустимый/);
 assert.throws(()=>buildSmallMissLocalReview(fixture,{
   8:{status:"normal_study" as "recheck",note:""}
 },at),/Недопустимый/);
 assert.throws(()=>buildSmallMissLocalReview(fixture,{
   7:{status:"recheck",note:""}
 },"bad-date"),/Время/);
});
test("refuses invalid native slice binding",()=>{
 const bad=structuredClone(fixture) as IchComponentEvidence;
 bad.componentEvidence.submilliliterReviewCandidates![0].reviewSliceIndexK=9;
 assert.throws(()=>buildSmallMissLocalReview(bad,{
   7:{status:"recheck",note:""}
 },at),/исходного среза/);
});
