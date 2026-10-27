import test from "node:test";
import assert from "node:assert/strict";
import {createLocalDetectorReview} from "./local-detector-physician-review.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
import type {DetectorDispatch} from "./dicom-detector-dispatch.ts";

const baseMeta={
 modality:"CT",bodyRegion:"HEAD",imageRole:"PRIMARY",seriesUid:"1.2.3",
 numberOfFrames:1,
} as TechnicalDicomMetadata;
const series:DicomSeries={
 key:"case",label:"public head CT",modality:"CT",volumeReady:true,spatiallySorted:true,
 warning:null,sliceSpacingMm:1,
 members:Array.from({length:9},(_,i)=>({id:"file"+i,name:"source",
  metadata:{...baseMeta,sopInstanceUid:"1.2.3."+(i+4)}})),
};
const finding={
 findingId:"ich-01",sign:"research candidate hemorrhagic focus",anatomy:"HEAD",
 status:"requires_recheck" as const,
 source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3.6",frameIndex:0,slicePositionMm:2},
 measurements:{diameterMm:null,volumeMl:null},
 model:{id:"ianpan/ct-head-hemorrhage-detection",version:"e6d89c2",provider:"local" as const},
 limitations:["uncalibrated research result"],
};
const empty:DetectorDispatch={executed:[],evidence:[],blocked:[
 {target:"intracerebral-hemorrhage",reason:"No registered executable model"},
]};
const withIch:DetectorDispatch={executed:["intracerebral-hemorrhage"],
 evidence:[{schema:"opus-evidence/v1",modality:"CT",coverage:"partially_assessed",
  seriesReviewed:["1.2.3"],findings:[finding],warnings:["Not clinically validated"]}],
 blocked:[{target:"brain-metastases",reason:"No registered executable model"}]};
const at="2026-10-28T00:01:00.000Z";
test("real local Evidence becomes original-source physician review without cloud or verified diagnosis",()=>{
 const result=createLocalDetectorReview(series,withIch,at);
 assert.equal(result.findings.length,1);
 assert.equal(result.findings[0].source.localFileId,"file2");
 assert.equal(result.findings[0].source.sopInstanceUid,"1.2.3.6");
 assert.equal(result.findings[0].model.id,"ianpan/ct-head-hemorrhage-detection");
 assert.equal(result.findings[0].status,"requires_recheck");
 assert.equal(result.conclusion.clinicalExclusionAllowed,false);
 assert.equal(result.clinicianSigned,false);
 assert.equal(result.cloudTransmissionAuthorized,false);
 assert.match(result.conclusion.text,/врачебная перепроверка/);
 assert.equal(result.executors[0].findingsCount,1);
 assert.equal(result.blocked[0].target,"brain-metastases");
 assert.equal(result.status,"unverified_research_draft");
});
test("zero findings and no installed models never produce false normal CT",()=>{
 const noModel=createLocalDetectorReview(series,empty,at);
 assert.equal(noModel.executors.length,0);
 assert.equal(noModel.findings.length,0);
 assert.equal(noModel.conclusion.kind,"no_evaluable_diagnostic_findings");
 assert.match(noModel.conclusion.text,/не исключает патологию/);
 const noCandidates=createLocalDetectorReview(series,{
  executed:["intracerebral-hemorrhage"],blocked:[],
  evidence:[{...withIch.evidence[0],coverage:"not_assessed",findings:[],seriesReviewed:[]}],
 },at);
 assert.equal(noCandidates.executors[0].coverage,"not_assessed");
 assert.equal(noCandidates.conclusion.clinicalExclusionAllowed,false);
});
test("tampered source UID, missing original, arbitrary status and stale input are rejected",()=>{
 const replace=(changed:Partial<typeof finding>)=>({
  ...withIch,evidence:[{...withIch.evidence[0],findings:[{...finding,...changed}]}],
 }) as DetectorDispatch;
 assert.throws(()=>createLocalDetectorReview(series,replace({
  source:{...finding.source,sopInstanceUid:"9.9.9"},
 }),at),/source|original DICOM/);
 assert.throws(()=>createLocalDetectorReview(series,replace({
  status:"verified_by_human" as never,
 }),at));
 assert.throws(()=>createLocalDetectorReview(series,replace({
  model:{...finding.model,provider:"openrouter" as never},
 }),at));
 assert.throws(()=>createLocalDetectorReview({...series,members:series.members.slice(0,2)},withIch,at));
 assert.throws(()=>createLocalDetectorReview(series,{...withIch,
  executed:["intracerebral-hemorrhage","intracerebral-hemorrhage"],
  evidence:[...withIch.evidence,...withIch.evidence]},at));
 assert.throws(()=>createLocalDetectorReview(series,withIch,"tomorrow"));
});
test("unknown extras (PHI, keys, secret get accessors) cannot leak into exported structured review",()=>{
 const extra={...finding,patientName:"PHI-SENTINEL",apiKey:"SECRET-SENTINEL"};
 Object.defineProperty(extra,"rawDicom",{enumerable:true,get(){throw Error("Opaque pixels must not be read");}});
 const report=createLocalDetectorReview(series,{
  ...withIch,evidence:[{...withIch.evidence[0],findings:[extra]}],
 },at);
 const text=JSON.stringify(report);
 assert.doesNotMatch(text,/PHI-SENTINEL|SECRET-SENTINEL|rawDicom/);
 assert.ok(text.includes("uncalibrated research result"));
});
