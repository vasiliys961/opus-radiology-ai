import test from "node:test";
import assert from "node:assert/strict";
import {originalNiftiSha256,readyOriginalNoduleWorker} from "./live-nodule-worker.ts";
import {sha256} from "@noble/hashes/sha2.js";

const cap={
 schema:"opus-monai-live-worker/v1",modelId:"monai-lung-nodule-ct-retinanet",
 modelVersion:"0.6.9",
 checkpointSha256:"b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01",
 modelRevision:"7226a40a4c3713f7d5469559b7f2fc296fd54825",
 originalWeightsVerified:true,mode:"local",
 dataPolicy:"approved-public-reference-only",
 sourceFormat:"original-nifti-uncompressed",patientMode:false,
 imageUpload:false,ready:true,unvalidatedResearch:true,
};
test("only pinned real pretrained MONAI worker is eligible",()=>{
 assert.equal(readyOriginalNoduleWorker(cap),true);
 for(const field of ["checkpointSha256","modelRevision","modelId","modelVersion"]){
   assert.equal(readyOriginalNoduleWorker({...cap,[field]:"spoofed"}),false,field);
 }
 for(const field of ["originalWeightsVerified","ready","unvalidatedResearch"]){
   assert.equal(readyOriginalNoduleWorker({...cap,[field]:false}),false,field);
 }
 assert.equal(readyOriginalNoduleWorker({...cap,patientMode:true}),false);
 assert.equal(readyOriginalNoduleWorker({...cap,imageUpload:true}),true);\n assert.equal(readyOriginalNoduleWorker({...cap,imageUpload:"true"}),false);
 assert.equal(readyOriginalNoduleWorker({...cap,dataPolicy:"patient"}),false);
 assert.equal(readyOriginalNoduleWorker(null),false);
});
test("streamed browser NIfTI digest equals actual original bytes (no pixel upload)",async()=>{
 const bytes=new Uint8Array(512);for(let i=0;i<bytes.length;i++)bytes[i]=(i*17)%256;
 const got=await originalNiftiSha256(new Blob([bytes]));
 const correct=Array.from(sha256(bytes),b=>b.toString(16).padStart(2,"0")).join("");
 assert.equal(got,correct);
 const changed=new Uint8Array(bytes);changed[511]^=0xff;
 assert.notEqual(got,await originalNiftiSha256(new Blob([changed])));
 const ctrl=new AbortController();ctrl.abort();
 await assert.rejects(originalNiftiSha256(new Blob([bytes]),ctrl.signal));
 await assert.rejects(originalNiftiSha256(new Blob([bytes.slice(0,50)])));
});
