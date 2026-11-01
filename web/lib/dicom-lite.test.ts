import test from "node:test";
import assert from "node:assert/strict";
import { decodeDicomPreview,parseDicomFrame, renderDicomPixels, DicomPreviewError } from "./dicom-lite.ts";

function syntheticDicom({syntax = "1.2.840.10008.1.2.1", signed = false, inverted = false,
  photometric, highBit, windowCenter, windowWidth}: {
    syntax?: string; signed?: boolean; inverted?: boolean; photometric?: string;
    highBit?: number; windowCenter?: number; windowWidth?: number;
  } = {}) {
  const parts: number[] = Array(128).fill(0).concat([...Buffer.from("DICM")]);
  const add = (group: number, element: number, vr: string, payload: Buffer) => {
    const length = payload.length + (payload.length % 2);
    const long = ["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UR", "UT", "UN"].includes(vr);
    const head = Buffer.alloc(long ? 12 : 8);
    head.writeUInt16LE(group, 0); head.writeUInt16LE(element, 2); head.write(vr, 4, "ascii");
    if (long) head.writeUInt32LE(length, 8); else head.writeUInt16LE(length, 6);
    parts.push(...head, ...payload, ...(length > payload.length ? [0] : []));
  };
  const us = (v: number) => {const b=Buffer.alloc(2);b.writeUInt16LE(v);return b;};
  add(0x0002, 0x0010, "UI", Buffer.from(syntax));
  add(0x0028, 0x0002, "US", us(1));
  add(0x0028, 0x0004, "CS", Buffer.from(photometric ?? (inverted ? "MONOCHROME1" : "MONOCHROME2")));
  if (windowCenter !== undefined) add(0x0028, 0x1050, "DS", Buffer.from(String(windowCenter)));
  if (windowWidth !== undefined) add(0x0028, 0x1051, "DS", Buffer.from(String(windowWidth)));
  add(0x0028, 0x0010, "US", us(2));
  add(0x0028, 0x0011, "US", us(2));
  add(0x0028, 0x0100, "US", us(16));
  add(0x0028, 0x0101, "US", us(12));
  if (highBit !== undefined) add(0x0028, 0x0102, "US", us(highBit));
  add(0x0028, 0x0103, "US", us(signed ? 1 : 0));
  const pixels = Buffer.alloc(8);
  [0, 1024, 2048, 4095].forEach((n, i) => pixels.writeUInt16LE(highBit === 15 ? n * 16 : n, i * 2));
  add(0x7fe0, 0x0010, "OW", pixels);
  return Uint8Array.from(parts).buffer;
}

function withOriginalUndefinedLengthSq(data:ArrayBuffer):ArrayBuffer{
 const input=Buffer.from(new Uint8Array(data));
 const pixel=input.indexOf(Buffer.from([0xe0,0x7f,0x10,0x00]));
 assert.ok(pixel>132);
 const header=Buffer.alloc(12);header.writeUInt16LE(0x0008,0);
 header.writeUInt16LE(0x1115,2);header.write("SQ",4);
 header.writeUInt32LE(0xffffffff,8);
 const item=Buffer.alloc(8);item.writeUInt16LE(0xfffe,0);
 item.writeUInt16LE(0xe000,2);item.writeUInt32LE(0xffffffff,4);
 const field=Buffer.alloc(14);field.writeUInt16LE(0x0008,0);
 field.writeUInt16LE(0x1150,2);field.write("UI",4);
 field.writeUInt16LE(6,6);field.write("1.2.3",8);
 const closeItem=Buffer.alloc(8);closeItem.writeUInt16LE(0xfffe,0);
 closeItem.writeUInt16LE(0xe00d,2);
 const closeSq=Buffer.alloc(8);closeSq.writeUInt16LE(0xfffe,0);
 closeSq.writeUInt16LE(0xe0dd,2);
 const out=Buffer.concat([input.subarray(0,pixel),header,item,field,closeItem,closeSq,input.subarray(pixel)]);
 return Uint8Array.from(out).buffer;
}
test("source-original undefined-length SQ is decoded only by validated bounded fallback",async()=>{
 const raw=withOriginalUndefinedLengthSq(syntheticDicom());
 assert.throws(()=>parseDicomFrame(raw),/неопределённой длины/);
 const original=new File([raw],"public-source-ct.dcm");
 await assert.rejects(
  decodeDicomPreview(original,{maxPixels:3}),/лимит локальной копии/,
  "Standards-aware SQ fallback must reach the same pixel limits");
});
test("reads uncompressed Part 10 technical metadata without patient fields", () => {
  const frame = parseDicomFrame(syntheticDicom());
  assert.equal(frame.metadata.width, 2);
  assert.equal(frame.metadata.height, 2);
  assert.equal(frame.metadata.bitsAllocated, 16);
  assert.equal(frame.metadata.transferSyntax, "1.2.840.10008.1.2.1");
  assert.equal(Object.hasOwn(frame.metadata, "patientName"), false);
  assert.equal(renderDicomPixels(frame).length, 16);
});

test("inverts MONOCHROME1 display without modifying source", () => {
  const frame = parseDicomFrame(syntheticDicom({inverted: true}));
  const pixels = renderDicomPixels(frame);
  assert.equal(pixels[0], 255);
  assert.equal(pixels[12], 0);
});

test("fails closed on unsupported compressed transfer syntax", () => {
  assert.throws(() => parseDicomFrame(syntheticDicom({syntax: "1.2.840.10008.1.2.4.90"})), DicomPreviewError);
});

test("rejects images without a DICM preamble", () => {
  assert.throws(() => parseDicomFrame(new ArrayBuffer(150)), DicomPreviewError);
});


test("left-justified 12-bit samples are shifted according to High Bit", () => {
  const aligned = renderDicomPixels(parseDicomFrame(syntheticDicom({highBit: 11})));
  const shifted = renderDicomPixels(parseDicomFrame(syntheticDicom({highBit: 15})));
  assert.deepEqual(shifted, aligned);
});

test("rejects PALETTE COLOR rather than silently displaying incorrect grayscale", () => {
  assert.throws(() => parseDicomFrame(syntheticDicom({photometric:"PALETTE COLOR"})), DicomPreviewError);
});

test("DICOM window width one becomes threshold rather than all black", () => {
  const pixels = renderDicomPixels(parseDicomFrame(syntheticDicom({windowCenter:1024,windowWidth:1})));
  assert.equal(pixels[0], 0);
  assert.equal(pixels[8], 255);
});

test("rejects high bit outside pixel allocation", () => {
  assert.throws(() => parseDicomFrame(syntheticDicom({highBit:16})), /High Bit/);
});

test("bounded privacy preview refuses excess pixels before allocating a canvas or RGBA",async()=>{
  const file=new File([syntheticDicom()],"synthetic-only.dcm");
  await assert.rejects(decodeDicomPreview(file,{maxPixels:3}),/лимит локальной копии/);
  await assert.rejects(decodeDicomPreview(file,{maxPixels:NaN}),/лимит локальной копии/);
});
