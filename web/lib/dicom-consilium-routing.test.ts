import { strict as assert } from "node:assert";
import { routeDicomConsilium } from "./dicom-consilium-routing.ts";
import type { DicomSeries, TechnicalDicomMetadata } from "./dicom-series.ts";
const metadata={modality:"CT",bodyRegion:"CHEST",imageRole:"PRIMARY",
  contrastAgentDeclared:false} as TechnicalDicomMetadata;
const series:DicomSeries={key:"s",label:"CT",modality:"CT",
  spatiallySorted:true,volumeReady:true,sliceSpacingMm:1,warning:null,
  members:[{id:"a",name:"f",metadata}]};
const route=routeDicomConsilium(series);
assert.equal(route.status,"ready");
assert.ok(route.specialists.includes("thoracic"));
assert.ok(route.specialists.includes("vascular"));
assert.ok(route.detectorTargets.includes("pulmonary-embolism"));
assert.equal(routeDicomConsilium(null).status,"blocked");
assert.equal(routeDicomConsilium({...series,members:[...series.members,
  {id:"b",name:"other",metadata:{...metadata,bodyRegion:"ABDOMEN"}}]}).status,"blocked");
assert.equal(routeDicomConsilium({...series,members:[{id:"a",name:"localizer",
  metadata:{...metadata,imageRole:"LOCALIZER"}}]}).status,"blocked");
assert.equal(routeDicomConsilium({...series,members:[{id:"a",name:"unknown",
  metadata:{...metadata,bodyRegion:null}}]}).status,"blocked");
console.log("PASS conservative DICOM consilium routes");
