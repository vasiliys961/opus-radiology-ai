import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDicomSeriesHeader, readDicomSeriesHeader, groupDicomSeries, type TechnicalDicomMetadata } from './dicom-series.ts';

function syntheticHeader({series = '1.2.3.4', position = '0\\0\\10', syntax = '1.2.840.10008.1.2.1', slope=null, intercept=null, unit=null}: {series?:string;position?:string;syntax?:string;slope?:string|null;intercept?:string|null;unit?:string|null} = {}) {
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
  if(slope!==null)add(0x28,0x1053,'DS',slope);
  if(intercept!==null)add(0x28,0x1052,'DS',intercept);
  if(unit!==null)add(0x28,0x1054,'LO',unit);
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

test('missing or empty DICOM DS coordinates never become invented zeros', () => {
  const invalid = [
    '', '   ', '  \\  \\  ', '1\\ \\3', '\\0\\3',
    '1\\2\\', '1\\2', '1\\2\\3\\4',
    '1\\NaN\\3', '0\\Infinity\\3', '0\\0x10\\3',
    '0\\1oops\\3',
  ];
  for (const position of invalid) {
    const parsed = parseDicomSeriesHeader(syntheticHeader({position}));
    assert.equal(parsed.imagePositionPatient, null,
      'Invalid DS must be absent: '+JSON.stringify(position));
  }
});

test('valid signed DS numbers, scientific notation and explicit zero remain valid', () => {
  for (const [position, expected] of [
    ['0\\0\\0', [0,0,0]],
    [' -12.5\\+0\\3.25 ',[-12.5,0,3.25]],
    ['1E-3\\-.5\\+2.',[0.001,-0.5,2]],
  ] as const) {
    assert.deepEqual(parseDicomSeriesHeader(syntheticHeader({position})).imagePositionPatient, expected);
  }
});

test('empty DS position blocks spatial sorting and 3D readiness, never an invented origin', () => {
  const entries = ['0\\0\\0','\\0\\1','0\\0\\2'].map((position,i)=>({
    id:String(i),name:String(i)+'.dcm',
    metadata:{...meta({sopInstanceUid:'1.2.3.'+i}),imagePositionPatient:
      parseDicomSeriesHeader(syntheticHeader({position})).imagePositionPatient},
  }));
  const [group] = groupDicomSeries(entries);
  assert.equal(group.spatiallySorted,false);
  assert.equal(group.volumeReady,false);
  assert.match(group.warning??'',/геометр|Порядок/);
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

/** Real-world studies may contain sequence items before the basic image tags. */
function complexHeader(withPreamble = true, position = '0\\0\\3'): ArrayBuffer {
  const chunks: Buffer[] = [];
  if (withPreamble) chunks.push(Buffer.alloc(128), Buffer.from('DICM'));
  function elem(group: number, element: number, vr: string, value: string) {
    const data = Buffer.from(value);
    const padded = data.length + data.length % 2;
    const h = Buffer.alloc(8);
    h.writeUInt16LE(group, 0); h.writeUInt16LE(element, 2);
    h.write(vr, 4, 'ascii'); h.writeUInt16LE(padded, 6);
    chunks.push(h, data, Buffer.alloc(padded-data.length));
  }
  if (withPreamble) elem(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
  elem(0x0008, 0x0060, 'CS', 'CT');
  // Referenced Study Sequence, undefined length, an empty item, a delimiter.
  const sq = Buffer.alloc(12);
  sq.writeUInt16LE(0x0008, 0); sq.writeUInt16LE(0x1110, 2);
  sq.write('SQ', 4); sq.writeUInt32LE(0xffffffff, 8);
  const item = Buffer.alloc(8);
  item.writeUInt16LE(0xfffe, 0); item.writeUInt16LE(0xe000, 2);
  const delim = Buffer.alloc(8);
  delim.writeUInt16LE(0xfffe, 0); delim.writeUInt16LE(0xe0dd, 2);
  chunks.push(sq, item, delim);
  elem(0x0020, 0x000d, 'UI', '1.2.3');
  elem(0x0020, 0x000e, 'UI', '1.2.3.4');
  elem(0x0008, 0x0018, 'UI', '1.2.3.4.5');
  elem(0x0020, 0x0032, 'DS', position);
  const pixel = Buffer.alloc(12);
  pixel.writeUInt16LE(0x7fe0, 0); pixel.writeUInt16LE(0x0010, 2);
  pixel.write('OW', 4); pixel.writeUInt32LE(160000, 8);
  chunks.push(pixel);
  return Uint8Array.from(Buffer.concat(chunks)).buffer;
}

test('complex undefined-length DICOM sequence no longer blocks series indexing', async () => {
  const file = new File([complexHeader()], 'image-000001.dcm');
  const header = await readDicomSeriesHeader(file);
  assert.equal(header.studyUid, '1.2.3');
  assert.equal(header.seriesUid, '1.2.3.4');
  assert.equal(header.modality, 'CT');
});

test('raw explicit-VR DICOM without 128-byte preamble is identified for indexing', async () => {
  const file = new File([complexHeader(false)], 'raw-image.dcm');
  const header = await readDicomSeriesHeader(file);
  assert.equal(header.studyUid, '1.2.3');
  assert.equal(header.seriesUid, '1.2.3.4');
  assert.equal(header.transferSyntax, '1.2.840.10008.1.2.1');
});

test('non-DICOM bytes are rejected rather than invented as a series', async () => {
  const file = new File([new Uint8Array([1,2,3,4])], 'invalid.dcm');
  await assert.rejects(readDicomSeriesHeader(file), /Не удалось разобрать структуру DICOM/);
});

test('complex SQ parser also rejects empty DS components (not just fast Part-10 path)', async () => {
  const invalid = new File([complexHeader(true, ' \\ \\4')], 'synthetic-invalid-complex.dcm');
  const bad = await readDicomSeriesHeader(invalid);
  assert.equal(bad.imagePositionPatient, null);
  const valid = new File([complexHeader(true, '-2\\0\\4.5')], 'synthetic-valid-complex.dcm');
  const good = await readDicomSeriesHeader(valid);
  assert.deepEqual(good.imagePositionPatient, [-2,0,4.5]);
});

test("CT HU rescale tags are recorded as numeric metadata, never decoded pixels",()=>{
 const x=parseDicomSeriesHeader(syntheticHeader({slope:"1",intercept:"-1024",unit:"HU"}));
 assert.equal(x.rescaleSlope,1);
 assert.equal(x.rescaleIntercept,-1024);
 assert.equal(x.rescaleUnit,"HU");
});
test("Invalid or absent DICOM CT rescale cannot silently default to 1/0",()=>{
 const missing=parseDicomSeriesHeader(syntheticHeader());
 assert.equal(missing.rescaleSlope,null);
 assert.equal(missing.rescaleIntercept,null);
 assert.equal(missing.rescaleUnit,"UNSPECIFIED");
 for(const input of ["","NaN","Infinity","-1","0","123oops","1e309"]){
   const x=parseDicomSeriesHeader(syntheticHeader({slope:input,intercept:"-1024",unit:"HU"}));
   assert.equal(x.rescaleSlope,null,input);
 }
 const alternative=parseDicomSeriesHeader(syntheticHeader({slope:"1",intercept:"-1024",unit:"SUV"}));
 assert.equal(alternative.rescaleUnit,"OTHER");
});
