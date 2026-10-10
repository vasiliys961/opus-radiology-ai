import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDicomSeriesHeader, groupDicomSeries, type TechnicalDicomMetadata } from './dicom-series.ts';

function syntheticHeader({series = '1.2.3.4', position = '0\\0\\10', syntax = '1.2.840.10008.1.2.1'} = {}) {
  const bytes: number[] = [...Buffer.alloc(128), ...Buffer.from('DICM')];
  const add = (group: number, element: number, vr: string, text: string) => {
    const value = Buffer.from(text);
    const len = value.length + (value.length % 2);
    const header = Buffer.alloc(8);
    header.writeUInt16LE(group, 0); header.writeUInt16LE(element, 2);
    header.write(vr, 4, 'ascii'); header.writeUInt16LE(len, 6);
    bytes.push(...header, ...value, ...(len > value.length ? [0] : []));
  };
  add(2, 0x10, 'UI', syntax);
  add(0x08, 0x18, 'UI', '1.2.3.4.5');
  add(0x20, 0xd, 'UI', '1.2.3');
  add(0x20, 0xe, 'UI', series);
  add(0x20, 0x52, 'UI', '1.2.7');
  add(0x20, 0x32, 'DS', position);
  add(0x20, 0x37, 'DS', '1\\0\\0\\0\\1\\0');
  add(0x20, 0x13, 'IS', '1');
  add(0x08, 0x60, 'CS', 'CT');
  const pixel = Buffer.alloc(12);
  pixel.writeUInt16LE(0x7fe0, 0);
  pixel.writeUInt16LE(0x0010, 2);
  pixel.write('OW', 4);
  pixel.writeUInt32LE(100_000_000, 8);
  bytes.push(...pixel); // pixel data intentionally omitted — metadata reader must stop here
  return Uint8Array.from(bytes).buffer;
}
function meta(overrides: Partial<TechnicalDicomMetadata> = {}): TechnicalDicomMetadata {
  return {sopInstanceUid: null, studyUid: '1', seriesUid: '2', frameOfReferenceUid: '3',
    modality: 'CT', instanceNumber: null, numberOfFrames: null, rows: 2, columns: 2, transferSyntax: '1.2.840.10008.1.2.1',
    imagePositionPatient: [0,0,0], imageOrientationPatient: [1,0,0,0,1,0], pixelSpacing: [1,1],...overrides};
}

test('metadata reader stops at PixelData and never needs complete pixel bytes', () => {
  const parsed = parseDicomSeriesHeader(syntheticHeader());
  assert.equal(parsed.seriesUid, '1.2.3.4');
  assert.equal(parsed.sopInstanceUid, '1.2.3.4.5');
  assert.equal(parsed.modality, 'CT');
  assert.deepEqual(parsed.imagePositionPatient, [0,0,10]);
  assert.equal(Object.hasOwn(parsed, 'patientName'), false);
});

test('compressed transfer syntax can be indexed without claiming it can be rendered', () => {
  const data = parseDicomSeriesHeader(syntheticHeader({syntax:'1.2.840.10008.1.2.4.90'}));
  assert.equal(data.transferSyntax, '1.2.840.10008.1.2.4.90');
});

test('sorts consistently oriented slices by physical normal, not filename or instance', () => {
  const items = [
    {id:'a', name:'a.dcm',metadata: meta({imagePositionPatient:[0,0,12],instanceNumber:1})},
    {id:'b', name:'b.dcm',metadata: meta({imagePositionPatient:[0,0,-2],instanceNumber:3})},
    {id:'c', name:'c.dcm',metadata: meta({imagePositionPatient:[0,0,4],instanceNumber:2})},
  ];
  const [group] = groupDicomSeries(items);
  assert.equal(group.spatiallySorted,true);
  assert.deepEqual(group.members.map(x=>x.id),['b','c','a']);
});

test('rejects unverified geometry and falls back to Instance Number without pretending a 3D volume', () => {
  const [group] = groupDicomSeries([
    {id:'a',name:'a',metadata:meta({imagePositionPatient:[0,0,0],instanceNumber:2})},
    {id:'b',name:'b',metadata:meta({imagePositionPatient:null,instanceNumber:1})},
  ]);
  assert.equal(group.spatiallySorted,false);
  assert.deepEqual(group.members.map(x=>x.id),['b','a']);
  assert.match(group.warning ?? '',/не подтверждена/);
});

test('never groups different studies, series or unknown UIDs together', () => {
  const groups = groupDicomSeries([
    {id:'a',name:'a',metadata:meta()},
    {id:'b',name:'b',metadata:meta({seriesUid:'other'})},
    {id:'c',name:'c',metadata:meta({studyUid:null})},
    {id:'d',name:'d',metadata:meta({studyUid:null})},
  ]);
  assert.equal(groups.length,4);
});


test('distinguishes spatial order from 3D readiness with irregular slice gaps', () => {
  const [series] = groupDicomSeries([
    {id:'a',name:'a',metadata:meta({imagePositionPatient:[0,0,0]})},
    {id:'b',name:'b',metadata:meta({imagePositionPatient:[0,0,1]})},
    {id:'c',name:'c',metadata:meta({imagePositionPatient:[0,0,4]})},
  ]);
  assert.equal(series.spatiallySorted,true);
  assert.equal(series.volumeReady,false);
  assert.match(series.warning ?? '',/неравномерный/);
});

test('accepts regular CT geometry for future un-resampled volume reconstruction', () => {
  const [series] = groupDicomSeries([
    {id:'a',name:'a',metadata:meta({sopInstanceUid:'1.2.3.1', imagePositionPatient:[0,0,4]})},
    {id:'b',name:'b',metadata:meta({sopInstanceUid:'1.2.3.2', imagePositionPatient:[0,0,2]})},
    {id:'c',name:'c',metadata:meta({sopInstanceUid:'1.2.3.3', imagePositionPatient:[0,0,0]})},
  ]);
  assert.equal(series.spatiallySorted,true);
  assert.equal(series.volumeReady,true);
  assert.equal(series.sliceSpacingMm,2);
  assert.equal(series.warning,null);
});

test('rejects volume readiness when Pixel Spacing differs', () => {
  const [series] = groupDicomSeries([
    {id:'a',name:'a',metadata:meta({imagePositionPatient:[0,0,0]})},
    {id:'b',name:'b',metadata:meta({imagePositionPatient:[0,0,2],pixelSpacing:[1.5,1]})},
  ]);
  assert.equal(series.spatiallySorted,true);
  assert.equal(series.volumeReady,false);
  assert.match(series.warning ?? '',/Pixel Spacing/);
});

test('flags duplicate SOP instance UIDs instead of treating copied slices as independent', () => {
  const [series] = groupDicomSeries([
    {id:'a',name:'a',metadata:meta({sopInstanceUid:'1.2.same',imagePositionPatient:[0,0,0]})},
    {id:'b',name:'b',metadata:meta({sopInstanceUid:'1.2.same',imagePositionPatient:[0,0,2]})},
  ]);
  assert.equal(series.volumeReady,false);
  assert.match(series.warning ?? '',/SOP Instance UID/);
});

test('prevents naive 3D with gantry tilt or in-plane drift', () => {
  const [series] = groupDicomSeries([
    {id:'a',name:'a',metadata:meta({imagePositionPatient:[0,0,0]})},
    {id:'b',name:'b',metadata:meta({imagePositionPatient:[1,0,2]})},
  ]);
  assert.equal(series.spatiallySorted,true);
  assert.equal(series.volumeReady,false);
  assert.match(series.warning ?? '',/Смещение/);
});

test('rejects malformed non-orthonormal orientation for spatial ordering', () => {
  const [series] = groupDicomSeries([
    {id:'a',name:'a',metadata:meta({imagePositionPatient:[0,0,0],imageOrientationPatient:[1,0,0,1,0,0]})},
    {id:'b',name:'b',metadata:meta({imagePositionPatient:[0,0,1],imageOrientationPatient:[1,0,0,1,0,0]})},
  ]);
  assert.equal(series.spatiallySorted,false);
  assert.equal(series.volumeReady,false);
});

test('flags multi-frame images although the header can be indexed', () => {
  const [series] = groupDicomSeries([
    {id:'a',name:'a',metadata:meta({numberOfFrames:12})},
  ]);
  assert.match(series.warning ?? '',/Мультифреймовый/);
  assert.equal(series.volumeReady,false);
});
