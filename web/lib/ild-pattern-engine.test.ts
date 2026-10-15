import {test} from "node:test";
import {strict as assert} from "node:assert";
import {interpretIldObservations} from "./ild-pattern-engine.ts";
test("insufficient input never produces a diagnosis",()=>{
 const x=interpretIldObservations({features:["reticulation","honeycombing","traction_bronchiectasis"],distribution:"basal_subpleural",axialSourceRefs:[],readerConfirmed:true});
 assert.equal(x.status,"insufficient_evidence");assert.deepEqual(x.candidates,[]);
});
test("UIP-like signs remain a research description",()=>{
 const x=interpretIldObservations({features:["reticulation","traction_bronchiectasis"],distribution:"basal_subpleural",axialSourceRefs:["12"],readerConfirmed:true});
 assert.equal(x.status,"research_differential_only");
 assert.match(x.candidates[0].name,/UIP/);assert.equal(x.clinicalValidation,false);
 assert.equal(x.requiresPhysicianReview,true);
});
test("GGO alone is not IPF",()=>{
 const x=interpretIldObservations({features:["ground_glass"],distribution:"diffuse",axialSourceRefs:["9"],readerConfirmed:true});
 assert.deepEqual(x.candidates,[]);
});
test("reject unknown labels and duplicate findings",()=>{
 assert.throws(()=>interpretIldObservations({features:["reticulation","reticulation"],distribution:"diffuse",axialSourceRefs:["9"],readerConfirmed:true}));
 assert.throws(()=>interpretIldObservations({features:["malignancy" as never],distribution:"diffuse",axialSourceRefs:["9"],readerConfirmed:true}));
});
test("HP-like appearances require more than mosaic density",()=>{
 const baseline={distribution:"upper_mid" as const,axialSourceRefs:["8"],readerConfirmed:true};
 const a=interpretIldObservations({...baseline,features:["mosaic_attenuation" as const]});
 const b=interpretIldObservations({...baseline,features:["mosaic_attenuation" as const,"centrilobular_nodules" as const]});
 assert.equal(a.candidates.length,0);
 assert.match(b.candidates[0].name,/HP/);
});
