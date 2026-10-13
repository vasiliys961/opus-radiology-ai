import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMprEligibility, MAX_MPR_FILES, assessMprDecodedMemory } from './mpr-eligibility.ts';
import type { DicomSeries, SeriesMember, TechnicalDicomMetadata } from './dicom-series.ts';

function series(count: number, rows = 512, columns = 512, valid = true): DicomSeries {
  const metadata: TechnicalDicomMetadata = {
    sopInstanceUid: '1.2.3', studyUid: '1', seriesUid: '2', frameOfReferenceUid: '3',
    modality: 'MR', instanceNumber: 1, numberOfFrames: 1, rows, columns,
    imagePositionPatient: [0, 0, 0], imageOrientationPatient: [1, 0, 0, 0, 1, 0], pixelSpacing: [1, 1], transferSyntax: '1.2.840.10008.1.2.1',
  };
  const members: SeriesMember[] = Array.from({length: count}, (_, n) => ({id: String(n), name:`${n}.dcm`, metadata: {...metadata, sopInstanceUid:`1.2.3.${n}`}}));
  return {key:'one',label:'test',modality:'MR',members,spatiallySorted:valid,volumeReady:valid,sliceSpacingMm:2,warning:valid ? null : 'Геометрия отсутствует'};
}

test('refuses an absent or geometrically invalid series', () => {
  assert.equal(checkMprEligibility(null, []).eligible, false);
  assert.match(checkMprEligibility(series(20,512,512,false),Array(20).fill(310_000)).reason,/Геометрия/);
});
test('accepts small properly formed series', () => {
  const r = checkMprEligibility(series(20), Array(20).fill(310_000));
  assert.equal(r.eligible, true);
  assert.equal(r.estimatedRawMiB,10);
});
test('rejects huge voxel volumes regardless of compressed size', () => {
  const r = checkMprEligibility(series(150,1024,1024), Array(150).fill(100_000));
  assert.equal(r.eligible,false);
  assert.match(r.reason,/48 МиБ/);
});
test('rejects excess slice count before loading', () => {
  assert.equal(checkMprEligibility(series(MAX_MPR_FILES+1), Array(MAX_MPR_FILES+1).fill(1000)).eligible,false);
});
test('rejects input byte total even if voxel count is small', () => {
  assert.match(checkMprEligibility(series(12,128,128),Array(12).fill(25*1048576)).reason,/256 МиБ/);
});
test('rejects non-matching, corrupted, or missing input lengths', () => {
  assert.equal(checkMprEligibility(series(12), Array(11).fill(2000)).eligible, false);
  assert.equal(checkMprEligibility(series(12), [...Array(11).fill(2000),Infinity]).eligible, false);
});
test('rejects incompatible dimensions and multi-frame series', () => {
  const s = series(10);
  s.members[2].metadata.rows = 64;
  assert.equal(checkMprEligibility(s, Array(10).fill(1000)).eligible,false);
  const t = series(10);
  t.members[2].metadata.numberOfFrames = 9;
  assert.equal(checkMprEligibility(t, Array(10).fill(1000)).eligible,false);
});

test('32 native 512px CT slices preserve existing research MPR admission',()=>{
  const plan=checkMprEligibility(series(32),Array(32).fill(524288));
  assert.equal(plan.eligible,true);
  assert.equal(plan.estimatedRawMiB,16);
  assert.equal(plan.estimatedDecodedMiB,32);
  assert.equal(plan.estimatedWorkingMiB,160);
});
test('preflight rejects buffer amplification despite passing the old 48 MiB raw ceiling',()=>{
  const before=series(72);
  const result=checkMprEligibility(before,Array(72).fill(1000));
  assert.ok(512*512*72*2<48*1024*1024);
  assert.equal(result.eligible,false);
  assert.match(result.reason,/бюджет/);
});
test('runtime guard rejects unexpectedly expanded image decoding before volume creation',()=>{
  const voxels=512*512*32;
  assert.equal(assessMprDecodedMemory(16*1048576,voxels).eligible,true);
  const expanded=assessMprDecodedMemory(96*1048576,voxels);
  assert.equal(expanded.eligible,false);
  assert.match(expanded.reason,/бюджет/);
  assert.equal(assessMprDecodedMemory(Number.NaN,voxels).eligible,false);
  assert.equal(assessMprDecodedMemory(-1,voxels).eligible,false);
  assert.equal(assessMprDecodedMemory(0,0).eligible,false);
});
test('preflight still refuses malformed dimensions before any allocation',()=>{
  const invalid=series(32);
  invalid.members[0].metadata.columns=NaN;
  assert.equal(checkMprEligibility(invalid,Array(32).fill(1000)).eligible,false);
});
