import {strict as assert} from "node:assert";
import {validatedPublicIchCapabilities,originalDicomDigests,
  IANPAN_MODEL_ID,IANPAN_MODEL_REVISION} from "./public-ich-worker.ts";
import {installedDetectorRegistry,type InstalledIanpanRuntime} from "./installed-detector-registry.ts";
import {dispatchDicomDetectors} from "./dicom-detector-dispatch.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
import type {EvidenceJson} from "./evidence-json.ts";

const modelAssetsSha256={
 "inference.py":"9792e50ad1d863e80a549d391ee53c5031d490abb75acba42d471b02a83fbafb",
 "classifier/model.safetensors":"525b5fc1731dab82fcdb1eb878570f4cf4b0fed483e307bc65e312a4d91c1489",
 "sequence/model.safetensors":"9421066cb5c6882087730b367b578f0fb8b6935391c2611bbc4bc2241c8ee487",
 "segmentation/fold0.safetensors":"d299e204c640bdc124829b5cc2e6d5e08973b8c17698a5bffdd565baa46ec786",
 "segmentation/fold1.safetensors":"1dbad6ad4dfd21e963e01a71f4486558287fe32e3acdcf47ad601ad8a3132c3e",
 "segmentation/fold2.safetensors":"e814b8e398b7c879c22663187d7c58ff88ee0fcaf11ea4e76859c35488b4d052",
 "segmentation/fold3.safetensors":"971bfe1163797c3587c045ef013475e6cd5973aa7116f8b01f8305725777910d",
 "segmentation/fold4.safetensors":"f1913ce8d7f9cacbb948615a7690cfad568fe0f713c1f11de9ac3199ff060e8f",
};
const cap={
 schema:"opus-public-ich-worker/v1",mode:"local",modelId:IANPAN_MODEL_ID,
 modelRevision:IANPAN_MODEL_REVISION,modelAssetsSha256,modelReady:true,
 resourceReady:true,dataPolicy:"public-reference-only",patientMode:false,
 inputTransfer:"hashes-only-preapproved-public-study",unvalidatedResearch:true,
 maxSlices:64,minFreeRamBytes:10*1024**3,
};
assert.ok(validatedPublicIchCapabilities(cap));
assert.equal(validatedPublicIchCapabilities({...cap,modelReady:false}),false);
assert.equal(validatedPublicIchCapabilities({...cap,patientMode:true}),false);
assert.equal(validatedPublicIchCapabilities({...cap,resourceReady:false}),false);
assert.equal(validatedPublicIchCapabilities({...cap,modelAssetsSha256:{
 ...modelAssetsSha256,"segmentation/fold4.safetensors":"0".repeat(64),
}}),false);

const metadata={modality:"CT",bodyRegion:"HEAD",imageRole:"PRIMARY",
 seriesUid:"1.2.3",numberOfFrames:1} as TechnicalDicomMetadata;
const series:DicomSeries={key:"head",label:"native source",modality:"CT",
 spatiallySorted:true,volumeReady:true,sliceSpacingMm:1,warning:null,
 members:Array.from({length:8},(_,i)=>({id:"f"+i,name:"public-source",
  metadata:{...metadata,sopInstanceUid:"1.2.3."+(i+4)}}))};
const files=new Map<string,Blob>(series.members.map((m,i)=>[m.id,new Blob([
 Uint8Array.from({length:200},(_,j)=>(j+i*13)%256),
])]));
const digests=await originalDicomDigests(series,files);
assert.equal(digests.length,8);
assert.ok(digests.every(x=>/^[a-f0-9]{64}$/.test(x)));
assert.deepEqual(digests,[...digests].sort());
await assert.rejects(()=>originalDicomDigests({...series,volumeReady:false},files));
await assert.rejects(()=>originalDicomDigests({...series,modality:"MR"},files));
await assert.rejects(()=>originalDicomDigests(series,new Map()));
const ev:EvidenceJson={schema:"opus-evidence/v1",modality:"CT",
 coverage:"partially_assessed",seriesReviewed:["1.2.3"],warnings:["unvalidated public source"],
 findings:[{findingId:"ich0",sign:"candidate intracerebral blood",
 anatomy:"head",status:"candidate",
 source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3.6",frameIndex:0,slicePositionMm:2},
 measurements:{diameterMm:null,volumeMl:null},
 model:{id:IANPAN_MODEL_ID,version:IANPAN_MODEL_REVISION,provider:"local"},limitations:[]}]};
const connected:InstalledIanpanRuntime={ready:true,modelId:IANPAN_MODEL_ID,modelRevision:IANPAN_MODEL_REVISION,
 dataPolicy:"public-reference-only" as const,run:async()=>ev};
assert.equal(installedDetectorRegistry({ianpanRuntime:connected}).executors.length,0);
const reg=installedDetectorRegistry({ianpanRuntime:connected,publicResearchAuthorized:true});
assert.equal(reg.executors.length,1);
const out=await dispatchDicomDetectors(series,reg.executors);
assert.deepEqual(out.executed,["intracerebral-hemorrhage"]);
assert.equal(out.evidence[0].findings[0].source.sopInstanceUid,"1.2.3.6");
assert.equal(out.evidence[0].findings[0].status,"requires_recheck");
const bad=installedDetectorRegistry({ianpanRuntime:{...connected,run:async()=>({
 ...ev,findings:[{...ev.findings[0],model:{...ev.findings[0].model,id:"unverified"}}],
})},publicResearchAuthorized:true});
const rejected=await dispatchDicomDetectors(series,bad.executors);
assert.equal(rejected.executed.length,0);
assert.equal(rejected.evidence.length,0);
console.log("PASS actual ICH worker-capability gate, hash-only source identity and common DICOM dispatch");
