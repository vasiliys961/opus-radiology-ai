import test from "node:test";
import assert from "node:assert/strict";
import { assessMprQuality } from "./mpr-quality.ts";
import type { DicomSeries, TechnicalDicomMetadata } from "./dicom-series.ts";

function series(normal: "axial" | "coronal" | "sagittal" | "oblique", through: number, inPlane: [number,number]): DicomSeries {
  const orientations = {
    axial: [1,0,0,0,1,0], coronal: [1,0,0,0,0,1], sagittal: [0,1,0,0,0,1],
    oblique: [Math.SQRT1_2,Math.SQRT1_2,0,0,0,1],
  } as const;
  const meta: TechnicalDicomMetadata = {
    sopInstanceUid:"1", studyUid:"2", seriesUid:"3", frameOfReferenceUid:"4", modality:"MR",
    instanceNumber:1, numberOfFrames:1, rows:512, columns:512,
    imagePositionPatient:[0,0,0], imageOrientationPatient:[...orientations[normal]] as [number, number, number, number, number, number],
    pixelSpacing:inPlane, transferSyntax:"1.2.840.10008.1.2.1",
  };
  return { key:"s",label:"",modality:"MR",members:[{id:"0",name:"0",metadata:meta}],
    spatiallySorted:true, volumeReady:true, sliceSpacingMm:through,warning:null};
}

test("detects native coronal axis and severe spacing anisotropy", () => {
  const r = assessMprQuality(series("coronal",4,[0.7,0.7]));
  assert.equal(r.nativePlane,"coronal");
  assert.equal(r.interpolationRisk,"high");
  assert.equal(r.anisotropy,5.7);
  assert.match(r.message,/утраченные детали/);
});
test("identifies axial and sagittal source orientation", () => {
  assert.equal(assessMprQuality(series("axial",1,[1,1])).nativePlane,"axial");
  assert.equal(assessMprQuality(series("sagittal",1,[1,1])).nativePlane,"sagittal");
});
test("oblique orientation is not advertised as a native orthogonal view", () => {
  assert.equal(assessMprQuality(series("oblique",3,[1,1])).nativePlane,null);
});
test("nearly isotropic spacing does not trigger the anisotropy warning", () => {
  const r = assessMprQuality(series("coronal",0.9,[0.8,1]));
  assert.equal(r.interpolationRisk,"low");
  assert.ok(r.anisotropy! < 2);
});
test("missing or invalid spacing returns unknown, not fictitious measurements", () => {
  assert.equal(assessMprQuality(null).anisotropy,null);
  const s = series("coronal",2,[1,1]);
  s.members[0].metadata.pixelSpacing = [0,1];
  assert.equal(assessMprQuality(s).interpolationRisk,"unknown");
  assert.equal(assessMprQuality({...s,sliceSpacingMm:null}).sliceSpacingMm,null);
});
