import test from "node:test";
import assert from "node:assert/strict";
import {prepareDicomMonaiFile} from "./dicom-monai-direct.ts";
import type {DicomSeries} from "./dicom-series.ts";

const empty={
 key:"test",label:"test",modality:"CT",members:[],spatiallySorted:false,
 volumeReady:false,sliceSpacingMm:null,warning:null,
} as DicomSeries;

test("direct MONAI source only accepts the currently selected complete chest CT",async()=>{
 await assert.rejects(prepareDicomMonaiFile(
  {...empty,modality:"MR"},[],new AbortController().signal),/DICOM-КТ/);
 await assert.rejects(prepareDicomMonaiFile(
  {...empty,members:[{id:"1",name:"one",metadata:{bodyRegion:"CHEST"}}] as DicomSeries["members"]},
  [],new AbortController().signal),/DICOM-КТ/);
});
test("aborted handoff does not allocate a source or start a model",async()=>{
 const ctrl=new AbortController();ctrl.abort();
 await assert.rejects(prepareDicomMonaiFile(empty,[],ctrl.signal),/DICOM-КТ|отменён/);
});
