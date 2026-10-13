import test from "node:test";
import assert from "node:assert/strict";
import {buildLocalDiagnosticDraft} from "./local-diagnostic-review.ts";
import type {BoundFinding} from "./ai-review.ts";
const finding:BoundFinding={findingId:"synthetic-finding",memberId:"synthetic-slice",
 seriesKey:"synthetic-series",sourceLabel:"synthetic.dcm",sign:"Неоднозначная гиподенсивность",
 anatomy:"Печень",needsRecheck:true};
const make=()=>({modality:"CT" as const,sourceBound:true,sourceChanged:false,
 aiResultSha256:"a".repeat(64),findings:[finding],
 decisions:{"synthetic-finding":"recheck" as const},
 differentials:{"synthetic-finding":"Проверить фазу контрастирования"},
 clinicalQuestion:"Каков характер находки?",
 clinicianSynthesis:"Предварительная гипотеза нуждается в визуальной проверке."});
test("local differential can be exported without automatic diagnosis or cloud use",()=>{
 const x=buildLocalDiagnosticDraft(make());
 assert.equal(x.status,"unverified-unsigned-review");
 assert.equal(x.source.aiResultSha256,"a".repeat(64));
 assert.equal(x.observations[0].memberId,"synthetic-slice");
 assert.equal(x.observations[0].decision,"recheck");
 assert.match(x.observations[0].differential,/контрастирования/);
 assert.equal(x.externalTransmission,false);
 assert.equal(x.automaticDiagnosis,false);
 assert.equal(x.excludesUnobservedDisease,false);
});
test("wrong study binding or tampered SHA cannot generate a clinical draft",()=>{
 assert.throws(()=>buildLocalDiagnosticDraft({...make(),sourceChanged:true}),/невозможно/i);
 assert.throws(()=>buildLocalDiagnosticDraft({...make(),sourceBound:false}),/невозможно/i);
 assert.throws(()=>buildLocalDiagnosticDraft({...make(),aiResultSha256:"bad"}),/SHA-256/);
});
test("no AI findings never means confirmed absence of pathology",()=>{
 const x=buildLocalDiagnosticDraft({...make(),findings:[]});
 assert.equal(x.observations.length,0);
 assert.equal(x.excludesUnobservedDisease,false);
});
test("duplicate observations, unsourced IDs, oversized or missing clinician summary fail",()=>{
 assert.throws(()=>buildLocalDiagnosticDraft({...make(),findings:[finding,finding]}),/Дублирующаяся/);
 assert.throws(()=>buildLocalDiagnosticDraft({...make(),clinicianSynthesis:" "}),/clinicianSynthesis/);
 assert.throws(()=>buildLocalDiagnosticDraft({...make(),differentiaIs:{},differentials:{"synthetic-finding":"x".repeat(1201)}}),/differential/);
});
