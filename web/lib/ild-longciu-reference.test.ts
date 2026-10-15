import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseLongCIUExpertReference} from "./ild-longciu-reference.ts";

const raw=readFileSync(new URL(
  "../public/examples/longciu-real-ild-ggo-expert-test40-run-38753711714.json",
  import.meta.url),"utf8");
const data=()=>JSON.parse(raw) as Record<string,unknown>;
test("real 40 independent 2D HRCT GGO masks are medical-source expert agreement, not UIP or model accuracy",()=>{
 const x=parseLongCIUExpertReference(raw);
 assert.equal(x.originalGithubActionRun,38753711714);
 assert.equal(x.authorsDesignatedTestSlices,40);
 assert.equal(x.test40.groundGlassOpacity.annotator1.mean2DDice,.745559);
 assert.equal(x.test40.groundGlassOpacity.annotator2.mean2DDice,.854955);
 assert.equal(x.test40.groundGlassOpacity.annotator3.mean2DDice,.648818);
 assert.equal(x.test40.consolidation.annotator1.nonEmptyUnionSlices,26);
 assert.equal(x.test40.consolidation.annotator2.mean2DDice,.580319);
 assert.equal(x.test40.consolidation.annotator3.mean2DDice,.615898);
 assert.equal(x.original90HumanAnnotator1MeanGgoDice,.77251);
 assert.equal(x.sourceIsContiguous3DCT,false);
 assert.equal(x.fibrosingILDSubtypeDiagnosisPossible,false);
 assert.equal(x.medpsegGgoAndConsolidationScoresWithheldPendingRegistrationAudit,true);
 assert.equal(x.clinicalValidation,false);
});
test("refuse forged model validation, wrongly contiguous CT and false fibrosis from non-specific GGO",()=>{
 const reference=data();
 for(const modified of [
   {sourceIsContiguous3DCT:true},{fibrosingILDSubtypeDiagnosisPossible:true},
   {clinicalValidation:true},{precomputedMedpsegModelRunByOpus:true},
   {precomputedMedpsegSourceRegistrationValidated:true},
   {honeycombingAndTractionBronchiectasisPresent:true},
   {originalGithubActionRun:123},{originalFullNumericArtifactSha256:"f".repeat(64)},
   {stapleIsConsensusOfComparedAnnotators:false},
 ]){
   assert.throws(()=>parseLongCIUExpertReference(JSON.stringify({...reference,...modified})));
 }
});
test("reject edited GGO/consolidation clinical numbers and target-label confusion",()=>{
 const reference=data();
 const first=structuredClone(reference) as typeof reference;
 const score=first.test40 as Record<string,Record<string,Record<string,number>>>;
 score.groundGlassOpacity.annotator1.mean2DDice=0.99;
 assert.throws(()=>parseLongCIUExpertReference(JSON.stringify(first)),/Числа/);
 const swapped=structuredClone(reference);
 (swapped.classLabels as Record<string,string>)["1"]="honeycombing";
 assert.throws(()=>parseLongCIUExpertReference(JSON.stringify(swapped)),/Подмена/);
});
