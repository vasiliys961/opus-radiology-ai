import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {parseIchAlternativeReport} from "./ianpan-ich-report.ts";
import {parseGenuineIchTwoModelEvidence} from "./ich-genuine-second-model-evidence.ts";

const a=readFileSync(new URL("../public/examples/ianpan-ich-real-figshare-run-38734338486.json",import.meta.url));
const b=readFileSync(new URL("../public/examples/ich-genuine-independent-totalseg-ianpan-run-38747034560.json",import.meta.url));
const hash=(raw:Buffer)=>createHash("sha256").update(raw).digest("hex");
const first=parseIchAlternativeReport(a.toString("utf8"));
const load=(raw:string,model=first,sha=hash(a),secondDigest=hash(b))=>
 parseGenuineIchTwoModelEvidence(raw,model,sha,secondDigest);
test("EXACT original second-model Action JSON and first pretrained research model are independently SHA-bound",()=>{
 assert.equal(b.length,1781);
 assert.equal(hash(b),"cb12ca4ae7bc115a5e82a6190cfcfa83bdadabe958227f918bd8cb94b0992234");
 assert.equal(hash(a),"c121d869f4358de9197232fc1c6eeb5ec2f6f8977af3e28ffb8130dcba365f62");
 const v=load(b.toString("utf8"));
 assert.equal(v.secondModelMaskPositiveVoxels,10875);
 assert.equal(v.secondModelMaskVoxelsInsideFirstModelBoundingBoxUnion,10862);
 assert.equal(v.secondModelUnvalidatedMaskVolumeMl,12.96401);
 assert.equal(v.secondModelMaskShareWithinFirstModelBounds,0.9988046);
 assert.deepEqual(v.secondModelSourceSliceIndices,[9,10,11,12,13,14,16]);
 assert.equal(v.segmentationDiceAgainstExpertMask,null);
 assert.equal(v.clinicalLesionTruePositive,null);
 assert.equal(v.clinicalValidation,false);
 assert.equal(v.independentRadiologistGroundTruthPresent,false);
});
test("reject altered second model report and altered first real network",()=>{
 const raw=b.toString("utf8");
 assert.throws(()=>load(raw,first,hash(a),"a".repeat(64)),/SHA-256/);
 assert.throws(()=>load(raw,first,"c".repeat(64)),/не совпадают/);
 const spoofed={...first,source:{...first.source,niftiSha256:"e".repeat(64)}};
 assert.throws(()=>load(raw,spoofed),/не совпадают/);
});
test("refuse false second-model clinical Dice, invented volume or changed voxel localization",()=>{
 const example=JSON.parse(b.toString("utf8"));
 for(const invalid of [
   {segmentationDiceAgainstExpertMask:.95},
   {independentRadiologistGroundTruthPresent:true},
   {clinicalValidation:true},
   {secondModelMaskPositiveVoxels:15000},
   {secondModelUnvalidatedMaskVolumeMl:99},
   {secondModelMaskShareWithinFirstModelBounds:1},
   {secondModelSourceSliceIndices:[9,10,11,12,13,14,15]}
 ]){
   assert.throws(()=>load(JSON.stringify({...example,...invalid})),/не совпадают/);
 }
});
