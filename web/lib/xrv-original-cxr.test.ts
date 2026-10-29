import test from "node:test";
import assert from "node:assert/strict";
import {parseOriginalXrvReport,SHA_XRV,XRV_CXR_LABELS} from "./xrv-original-cxr.ts";
const source="b".repeat(64);
const values={Pneumothorax:0.172315,Cardiomegaly:0.667162,Effusion:0.566473,
 Pneumonia:0.501093,Edema:0.501593,Mass:0.532159};
const valid={
 schema:"opus-original-xrv-cxr-six-head/v1",sourcePngSha256:source,
 model:"densenet121-res224-nih",modelWeightSha256:SHA_XRV,
 actualPretrainedModelForwardCompleted:true,labels:values,
 spatialLocalizationSupported:false,clinicalValidation:false,
 scoresAreCalibratedProbabilities:false,negativeDiagnosisPermitted:false,
 patientMode:false,
 limitations:["research-only","uncalibrated","not a diagnosis","no spatial ground truth"],
};
test("Six actual publisher-trained heads are one model with original source SHA",()=>{
 assert.deepEqual(XRV_CXR_LABELS,["Pneumothorax","Cardiomegaly","Effusion",
   "Pneumonia","Edema","Mass"]);
 assert.equal(parseOriginalXrvReport(valid,source).labels.Cardiomegaly,0.667162);
 for(const modified of [
   {sourcePngSha256:"c".repeat(64)},
   {modelWeightSha256:"c".repeat(64)},
   {model:"mock"},
   {actualPretrainedModelForwardCompleted:false},
   {clinicalValidation:true},
   {patientMode:true},
   {negativeDiagnosisPermitted:true},
   {scoresAreCalibratedProbabilities:true},
   {spatialLocalizationSupported:true},
   {labels:{...values,Mass:1.2}},
   {labels:{...values,Mass:NaN}},
   {labels:{...values,Pneumonia:undefined}},
   {labels:{...values,newTarget:.5}},
 ]){
  assert.throws(()=>parseOriginalXrvReport({...valid,...modified},source));
 }
});
