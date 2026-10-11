import test from "node:test";
import assert from "node:assert/strict";
import { parseDicomSeriesHeader, groupDicomSeries,
  type TechnicalDicomMetadata, type DicomSeries } from "./dicom-series.ts";
import { analyzeDicomStudy } from "./study-intelligence-v17.ts";
import { evaluatePatientCloudRelease, PATIENT_CLOUD_TRANSMISSION_RELEASED } from "./patient-cloud-policy.ts";

function part10(fields: Array<[number, number, string, string]>): ArrayBuffer {
  const chunks: Buffer[] = [Buffer.alloc(128), Buffer.from("DICM")];
  function tag(group: number, element: number, vr: string, text: string) {
    const value = Buffer.from(text);
    const size = value.length + value.length % 2;
    const header = Buffer.alloc(8);
    header.writeUInt16LE(group, 0); header.writeUInt16LE(element, 2);
    header.write(vr, 4, "ascii"); header.writeUInt16LE(size, 6);
    return Buffer.concat([header, value, Buffer.alloc(size-value.length)]);
  }
  chunks.push(tag(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"));
  for (const field of fields) chunks.push(tag(...field));
  const pixel = Buffer.alloc(12);pixel.writeUInt16LE(0x7fe0,0);pixel.writeUInt16LE(0x0010,2);pixel.write("OW",4);
  pixel.writeUInt32LE(100_000_000,8);chunks.push(pixel);
  const buffer = Buffer.concat(chunks);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
function meta(overrides: Partial<TechnicalDicomMetadata> = {}): TechnicalDicomMetadata {
  return {
    sopInstanceUid:"1.2.3.1",studyUid:"1.2.3",seriesUid:"1.2.4",
    frameOfReferenceUid:"1.2.5",modality:"MR",
    instanceNumber:1,numberOfFrames:null,rows:64,columns:64,
    imagePositionPatient:[0,0,0],imageOrientationPatient:[1,0,0,0,1,0],
    pixelSpacing:[1,1],transferSyntax:"1.2.840.10008.1.2.1",
    bodyRegion:"HEAD",imageRole:"PRIMARY",mrSequenceCodes:["SE"],
    repetitionTimeMs:2000,echoTimeMs:95,inversionTimeMs:null,sliceThicknessMm:2,
    contrastAgentDeclared:false,...overrides,
  };
}
function seriesWith(
  values: Array<Partial<TechnicalDicomMetadata>>, base: Partial<TechnicalDicomMetadata> = {},
): DicomSeries {
  const valuesArr = values.map((changes,i) => ({
    id:"slice-"+i,name:"slice-"+i+".dcm", metadata:meta({
      ...base,sopInstanceUid:"1.2.4."+i,imagePositionPatient:[0,0,i*2],...changes,
    }),
  }));
  return groupDicomSeries(valuesArr)[0];
}
test("Part 10 extracts allowlisted body, image-role and MR timing without free text", () => {
  const hdr=part10([
    [0x0008,0x0008,"CS","ORIGINAL\\PRIMARY\\AXIAL"],
    [0x0008,0x0060,"CS","MR"],
    [0x0008,0x103E,"LO","Sensitive Patient Name and DOB"], // ignored
    [0x0018,0x0015,"CS","BRAIN"],
    [0x0018,0x0020,"CS","SE\\IR"],
    [0x0018,0x0050,"DS","2.5"],
    [0x0018,0x0080,"DS","7500"],
    [0x0018,0x0081,"DS","105"],
    [0x0018,0x0082,"DS","2300"],
    [0x0020,0x000D,"UI","1.2.3"],
    [0x0020,0x000E,"UI","1.2.4"],
  ]);
  const m=parseDicomSeriesHeader(hdr);
  assert.equal(m.bodyRegion,"HEAD");
  assert.equal(m.imageRole,"PRIMARY");
  assert.deepEqual(m.mrSequenceCodes,["SE","IR"]);
  assert.equal(m.repetitionTimeMs,7500);
  assert.equal(m.echoTimeMs,105);
  assert.equal(m.inversionTimeMs,2300);
  assert.equal(m.sliceThicknessMm,2.5);
  assert.doesNotMatch(JSON.stringify(m), /Sensitive|Patient Name|DOB/);
});
test("Nonstandard patient-containing body-part text never enters extracted metadata", () => {
  const m=parseDicomSeriesHeader(part10([
    [0x0008,0x0060,"CS","CT"],
    [0x0018,0x0015,"LO","HEAD JANE SMITH"],
    [0x0018,0x0010,"LO","Confidential Contrast Brand"],
    [0x0008,0x0008,"CS","DERIVED\\SECONDARY"],
  ]));
  assert.equal(m.bodyRegion,null);
  assert.equal(m.imageRole,"DERIVED");
  assert.equal(m.contrastAgentDeclared,true);
  assert.doesNotMatch(JSON.stringify(m), /JANE|SMITH|Brand/);
});
test("All-series scanner audit returns protocol candidates without claiming completion", () => {
  const head = seriesWith([{}, {}, {}]);
  const chest = seriesWith([{}, {}, {}], {
    modality:"CT",seriesUid:"1.2.99",bodyRegion:"CHEST",
    imageRole:"PRIMARY",mrSequenceCodes:[],repetitionTimeMs:null,echoTimeMs:null,
  });
  const report=analyzeDicomStudy([head,chest]);
  assert.equal(report.indexedSeries,2);
  assert.equal(report.indexedDicomFiles,6);
  assert.equal(report.completeness,"not-verifiable");
  assert.equal(report.protocolDetection,"technical-metadata-only");
  assert.equal(report.series[0].volumeReady,true);
  assert.match(report.series[0].protocolCandidate,/T2-подобные/);
  assert.equal(report.series[0].spatialExtentMm,4);
  assert.equal(report.series[1].region,"CHEST");
  assert.match(report.series[1].protocolCandidate,/КТ/);
  assert.ok(report.issues.some(i=>i.code==="MIXED_MODALITY"));
  assert.ok(report.issues.some(i=>i.code==="UNKNOWN_COMPLETENESS"));
});
test("Localizers, contradictory regions, different protocol timing and unindexed files are flagged", () => {
  const s=seriesWith([
    {imageRole:"LOCALIZER",bodyRegion:"HEAD",repetitionTimeMs:100},
    {imageRole:"LOCALIZER",bodyRegion:"CHEST",repetitionTimeMs:150},
    {imageRole:"LOCALIZER",bodyRegion:"HEAD",repetitionTimeMs:100},
  ]);
  const report=analyzeDicomStudy([s],2);
  assert.equal(report.unindexedDicomFiles,2);
  assert.equal(report.series[0].region,"НЕ ОПРЕДЕЛЕНА");
  assert.ok(report.issues.some(i=>i.code==="MIXED_BODY_REGION"));
  assert.ok(report.issues.some(i=>i.code==="INCONSISTENT_TECHNICAL_PROTOCOL"));
  assert.ok(report.issues.some(i=>i.code==="LOCALIZER"));
  assert.ok(report.issues.some(i=>i.code==="UNINDEXED_DICOM"));
  assert.notEqual(report.completeness,"confirmed");
});
test("Irregular slices and separate StudyUIDs never become evidence of full volume", () => {
  const bad=seriesWith([
    {imagePositionPatient:[0,0,0]},
    {imagePositionPatient:[0,0,2]},
    {imagePositionPatient:[0,0,12]},
  ]);
  const unrelated=seriesWith([{}, {}, {}],{studyUid:"9.99",seriesUid:"9.98"});
  const report=analyzeDicomStudy([bad,unrelated]);
  assert.equal(bad.volumeReady,false);
  assert.equal(report.series[0].spatialExtentMm,null);
  assert.ok(report.issues.some(x=>x.code==="GEOMETRY_UNVERIFIED"));
  assert.ok(report.issues.some(x=>x.code==="MULTIPLE_STUDIES"));
});
test("Patient cloud release remains blocked even when all caller-defined claims are true", () => {
  const all = {
    physicianAuthentication:true,studyConsent:true,dicomDeidentification:true,
    pixelPrivacy:true,providerJurisdiction:true,auditRetention:true,clinicalValidation:true,
  };
  assert.equal(PATIENT_CLOUD_TRANSMISSION_RELEASED,false);
  assert.equal(evaluatePatientCloudRelease(null).permitted,false);
  const result=evaluatePatientCloudRelease(all);
  assert.equal(result.permitted,false);
  assert.ok(result.missing.includes("production-release-not-implemented"));
});
