import {test} from "node:test";
import {strict as assert} from "node:assert";
import {interpretChestObservations} from "./chest-extra-pulmonary.ts";
test("no findings never establishes a normal CT",()=>{
 const result=interpretChestObservations([]);
 assert.equal(result.status,"insufficient_evidence");assert.match(result.missing.join(" "),/не исключает патологию/);
});
test("vertebral evidence keeps original slice and bone window limitation",()=>{
 const result=interpretChestObservations([{region:"spine",finding:"vertebral_compression",slice:34,readerConfirmed:true,contrast:"noncontrast"}]);
 assert.equal(result.evidence[0].slice,34);
 assert.match(result.evidence[0].limitations.join(" "),/костном окне/);
 assert.equal(result.clinicalValidation,false);
});
test("unconfirmed observations withheld",()=>{
 assert.equal(interpretChestObservations([{region:"heart",finding:"pericardial_effusion",slice:4,readerConfirmed:false,contrast:"unknown"}]).evidence.length,0);
});
test("reject wrong region and impossible measures",()=>{
 assert.throws(()=>interpretChestObservations([{region:"spine",finding:"cardiomegaly",slice:9,readerConfirmed:true,contrast:"contrast"}]));
 assert.throws(()=>interpretChestObservations([{region:"heart",finding:"cardiomegaly",slice:9,readerConfirmed:true,contrast:"contrast",measurementMm:-1}]));
});
test("urgent observations are not silently downgraded",()=>{
 const result=interpretChestObservations([{region:"pleura",finding:"pneumothorax",slice:18,readerConfirmed:true,contrast:"unknown"}]);
 assert.match(result.evidence[0].limitations.join(" "),/срочная/);
});
