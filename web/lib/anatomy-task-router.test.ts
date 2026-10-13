import test from "node:test";
import assert from "node:assert/strict";
import {planAnatomicalTasks} from "./anatomy-task-router.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";

const base:TechnicalDicomMetadata={
  sopInstanceUid:"1.2.3.4",studyUid:"1.2.3",seriesUid:"1.2.3.5",
  frameOfReferenceUid:"1.2.3.6",modality:"CT",instanceNumber:1,numberOfFrames:1,
  rows:512,columns:512,imagePositionPatient:[0,0,0],
  imageOrientationPatient:[1,0,0,0,1,0],pixelSpacing:[1,1],
  transferSyntax:"1.2.840.10008.1.2.1",
  bodyRegion:"ABDOMEN",imageRole:"PRIMARY",mrSequenceCodes:[],
  repetitionTimeMs:null,echoTimeMs:null,inversionTimeMs:null,
  sliceThicknessMm:3,contrastAgentDeclared:false,
};
let n=0;
const study=(modality:"CT"|"MR",region:TechnicalDicomMetadata["bodyRegion"],
    overrides:Partial<TechnicalDicomMetadata>={},extra:{ready?:boolean;uid?:string}={}):DicomSeries=>{
  const key="test-"+(++n);
  const uid=extra.uid??"1.2.3";
  const meta={...base,modality,bodyRegion:region,studyUid:uid,...overrides};
  return {key,label:"Synthetic series",modality,
    members:[0,1,2].map(i=>({id:key+"."+i,name:"no-patient.dcm",
      metadata:{...meta,imagePositionPatient:[0,0,i*3],sopInstanceUid:key+"."+i}})),
    spatiallySorted:extra.ready??true,volumeReady:extra.ready??true,
    sliceSpacingMm:extra.ready===false?null:3,warning:null};
};

test("CT abdomen yields a reviewable, NOT runnable anatomy candidate with no invented liver diagnosis",()=>{
  const routes=planAnatomicalTasks([study("CT","ABDOMEN")]);
  assert.equal(routes.length,1);
  assert.equal(routes[0].id,"ct-abdomen-organs");
  assert.equal(routes[0].preparation,"review_source");
  assert.equal(routes[0].execution,"not_connected");
  assert.equal(routes[0].canRun,false);
  assert.equal(routes[0].canIssueNegativeFinding,false);
  assert.ok(routes[0].reasons.includes("ct_calibration_and_phase_unverified"));
  assert.ok(routes[0].reasons.includes("weights_not_connected"));
});
test("CT chest is a past research verification, not connected to the live patient task runner",()=>{
  const r=planAnatomicalTasks([study("CT","CHEST")])[0];
  assert.equal(r.id,"ct-chest-lobes");assert.equal(r.canRun,false);
  assert.match(r.technicalHints[0],/Linux\/Chromium/);
});
test("MR HEAD requires real four-series protocol and model; T1/FLAIR heuristics are not proof",()=>{
  const a=study("MR","HEAD",{mrSequenceCodes:["IR"],repetitionTimeMs:4000,
    inversionTimeMs:2000,echoTimeMs:110});
  const r=planAnatomicalTasks([a])[0];
  assert.equal(r.id,"mr-brain-multisequence");
  assert.ok(r.reasons.includes("mr_4_series_not_confirmed"));
  assert.ok(r.reasons.includes("mr_exact_sequences_unverified"));
  assert.match(r.technicalHints[0],/FLAIR-подобные/);
  assert.equal(r.canRun,false);
});
test("series with same study UID group; different studies never mix to fake four MRI channels",()=>{
  const same=[study("MR","HEAD"),study("MR","HEAD"),study("MR","HEAD"),
    study("MR","HEAD")];
  const group=planAnatomicalTasks(same);
  assert.equal(group.length,1);
  assert.equal(group[0].inputSeriesKeys.length,4);
  assert.ok(group[0].reasons.includes("mr_exact_sequences_unverified"));
  assert.equal(group[0].canRun,false);
  const split=planAnatomicalTasks([
    same[0],same[1],same[2],study("MR","HEAD",{}, {uid:"9.99"})]);
  assert.equal(split.length,2);
  assert.equal(split[0].inputSeriesKeys.length,3);
  assert.ok(split.every(r=>r.reasons.includes("mr_4_series_not_confirmed")));
});
test("localizer, unindexed frames, wrong anatomy and incorrect geometry always block preparation",()=>{
  const loc=study("CT","ABDOMEN",{imageRole:"LOCALIZER"},{ready:false});
  const r=planAnatomicalTasks([loc],2)[0];
  for(const reason of ["protocol_role_unverified","geometry_unverified","source_incomplete_or_unknown"])
    assert.ok(r.reasons.includes(reason));
  assert.equal(r.preparation,"needs_series_and_protocol");
  assert.equal(planAnatomicalTasks([study("CT",null)]).length,0);
  assert.equal(planAnatomicalTasks([study("MR","EXTREMITY")]).length,0);
});
test("conflicting BodyPartExamined does not create a trusted abdomen route",()=>{
  const mixed=study("CT","ABDOMEN");
  mixed.members[1].metadata.bodyRegion="CHEST";
  const routes=planAnatomicalTasks([mixed]);
  assert.equal(routes.length,2);
  assert.ok(routes.every(r=>r.reasons.includes("region_conflict")));
  assert.ok(routes.every(r=>r.canRun===false));
});
test("no patient data or automation/evasive inference can be derived from these routes",()=>{
  assert.deepEqual(planAnatomicalTasks([]),[]);
  assert.throws(()=>planAnatomicalTasks([], -1));
  const r=planAnatomicalTasks([study("MR","HEAD")])[0];
  assert.ok(!JSON.stringify(r).includes("1.2.3.6"));
  assert.equal(r.clinicallyValidated,false);
  assert.equal(r.fullCoverageVerified,false);
});
