import test from "node:test";
import assert from "node:assert/strict";
import {calculateManualIchVolume} from "./ich-volume.ts";

test("ABC/2 uses measured millimeters and converts to approximate mL",()=>{
 const v=calculateManualIchVolume({aMm:40,bMm:30,cMm:20},"ct-head-research");
 assert.equal(v.approximateVolumeMl,12);
 assert.equal(v.dimensionsMm.aMm,40);
 assert.equal(v.target,"single_intraparenchymal_hemorrhage");
 assert.equal(v.source.seriesKey,"ct-head-research");
 assert.equal(v.source.sourceDicomCoordinatesVerified,false);
 assert.equal(v.automatedDetection,false);
 assert.equal(v.diagnosisConfirmed,false);
 assert.equal(v.absenceOfHemorrhageEstablished,false);
 assert.equal(v.clinicianIdentityVerified,false);
 assert.ok(v.limitations.some(x=>x.includes("внутрижелудочкового")));
});
test("clinical input guards reject unmeasured, negative, nonfinite or enormous diameters",()=>{
 for(const dimensions of [
  {aMm:0,bMm:30,cMm:20},{aMm:-3,bMm:30,cMm:20},
  {aMm:Infinity,bMm:30,cMm:20},{aMm:NaN,bMm:30,cMm:20},
  {aMm:301,bMm:30,cMm:20}
 ])assert.throws(()=>calculateManualIchVolume(dimensions,"ct-head"));
 assert.throws(()=>calculateManualIchVolume({aMm:40,bMm:30,cMm:20},""),/серией/);
 assert.throws(()=>calculateManualIchVolume({aMm:40,bMm:30,cMm:20},"x".repeat(161)),/серией/);
});
test("this function never performs imaging analysis or creates automatic negative conclusions",t=>{
 t.mock.method(globalThis,"fetch",async()=>{throw Error("Unexpected network")});
 const x=calculateManualIchVolume({aMm:10,bMm:10,cMm:10},"head");
 assert.equal(x.approximateVolumeMl,0.5);
 assert.equal(x.status,"clinician-entered-unsigned-research-estimate");
 assert.equal(x.automatedDetection,false);
});
