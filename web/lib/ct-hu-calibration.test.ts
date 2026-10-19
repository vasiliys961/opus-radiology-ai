import test from "node:test";
import assert from "node:assert/strict";
import {assessCtHuCalibration} from "./ct-hu-calibration.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
const ct=(extra:Partial<TechnicalDicomMetadata>={})=>({
  modality:"CT",rescaleSlope:1,rescaleIntercept:-1024,rescaleUnit:"HU",
  numberOfFrames:1,...extra,
}) as TechnicalDicomMetadata;
const source=(overrides:Partial<DicomSeries>={}):DicomSeries=>({
  key:"series-local-1",label:"local",modality:"CT",spatiallySorted:true,
  volumeReady:true,sliceSpacingMm:1,warning:null,
  members:Array.from({length:4},(_,i)=>({id:"local-"+i,name:"slice-"+i,
    metadata:ct()})),
  ...overrides,
});
test("All original CT frames with exact HU rescale values become metadata-ready, not LAA-ready",()=>{
 const result=assessCtHuCalibration(source());
 assert.equal(result.status,"metadata-ready");
 assert.equal(result.slope,1);
 assert.equal(result.intercept,-1024);
 assert.equal(result.units,"HU");
 assert.equal(result.frameCount,4);
 assert.equal(result.decodedHuVerified,false);
 assert.equal(result.quantitativeLaa950Permitted,false);
});
test("Missing, differing or non-HU transforms reject quantitative metadata eligibility",()=>{
 for(const bad of [
   {...source(),members:source().members.map((x,i)=>({
     ...x,metadata:ct(i===2?{rescaleSlope:1.5}:{})}))},
   {...source(),members:source().members.map((x,i)=>({
     ...x,metadata:ct(i===2?{rescaleIntercept:-500}:{})}))},
   {...source(),members:source().members.map(x=>({...x,metadata:ct({rescaleUnit:"OTHER"})}))},
   {...source(),members:source().members.map(x=>({...x,metadata:ct({rescaleUnit:"UNSPECIFIED"})}))},
   {...source(),members:source().members.map(x=>({...x,metadata:ct({rescaleIntercept:null})}))},
   {...source(),members:source().members.map(x=>({...x,metadata:ct({rescaleSlope:null})}))},
   {...source(),members:source().members.map(x=>({...x,metadata:ct({numberOfFrames:9})}))},
 ])assert.equal(assessCtHuCalibration(bad as DicomSeries).status,"blocked");
});
test("Never mix MR, spatially inconsistent or missing series into CT HU pipeline",()=>{
 assert.equal(assessCtHuCalibration(null).status,"blocked");
 assert.equal(assessCtHuCalibration(source({modality:"MR"})).status,"blocked");
 assert.equal(assessCtHuCalibration(source({volumeReady:false})).status,"blocked");
 assert.equal(assessCtHuCalibration(source({spatiallySorted:false})).status,"blocked");
});
