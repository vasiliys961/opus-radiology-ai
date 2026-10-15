import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {parseRealPlethoraHumanReference} from "./plethora-real-reference.ts";

const raw=readFileSync(new URL(
 "../public/examples/plethora-real-two-human-effusion-reference-run-38750003799.json",
 import.meta.url));
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
test("REAL official 2020 TCIA two-reviewer pleural effusion source; no pretrained model involved",()=>{
 assert.equal(raw.length,1737);
 assert.equal(sha(raw),"50718acb2a3049266443b31addb46cb8e384daca34c73966420fee8c01b12e6d");
 const result=parseRealPlethoraHumanReference(raw.toString("utf8"),sha(raw));
 assert.equal(result.multipleOriginalExpertReviewPairsPresent,78);
 assert.deepEqual(result.originalShapeXYZ,[512,512,134]);
 assert.equal(result.originalReviewerAMaskVoxels,63668);
 assert.equal(result.originalReviewerBMaskVoxels,54206);
 assert.equal(result.originalExpertIntersectionVoxels,52625);
 assert.equal(result.humanExpertInterreaderDice,.89290259);
 assert.ok(Math.abs(2*52625/(63668+54206)-result.humanExpertInterreaderDice)<1e-7);
 assert.equal(result.modelInferencePerformed,false);
 assert.equal(result.expertHumanAgreementIsModelAccuracy,false);
 assert.equal(result.nativeMaskToOriginalDicomGeometryVerified,false);
 assert.equal(result.medicalUseValidated,false);
});
test("reject a forged human expert benchmark, CT association or invented model Dice",()=>{
 const parsed=JSON.parse(raw.toString("utf8"));
 assert.throws(()=>parseRealPlethoraHumanReference(raw.toString("utf8"),"f".repeat(64)),/SHA-256/);
 for(const altered of [
  {modelInferencePerformed:true},
  {medicalUseValidated:true},
  {nativeMaskToOriginalDicomGeometryVerified:true},
  {humanExpertInterreaderDice:.99999},
  {originalExpertIntersectionVoxels:70000},
  {referencePatientIdIncluded:true},
  {publisherDoi:"invented"},
 ]){
  assert.throws(()=>parseRealPlethoraHumanReference(JSON.stringify({...parsed,...altered}),sha(raw)),/SHA-256/);
 }
});
