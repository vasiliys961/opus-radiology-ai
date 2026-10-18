/** Send only bounded numeric LOCAL R231 segmentation measurements to a
 * LOCAL LLM. Never send DICOM, a source UID, input/mask hash, pixel, file name,
 * patient information, reviewer text or a suspected pathology diagnosis.
 */
import type {SegmentationEvidence} from "./segmentation-evidence.ts";

export type LocalLungFacts={
  schema:"opus-local-r231-facts/v1";
  model:"lungmask-R231";
  frameCount:number;rightLungMaskMl:number;leftLungMaskMl:number;
  coverage:"not-clinically-verified";
  masksAreNotPathologyDetectors:true;
};
export type LocalLungReview={
 schema:"opus-local-lung-llm-review/v1";
 summary:string;qualityQuestions:string[];limitations:string[];
};
const SHA="d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f";
function finiteVolume(value:unknown):value is number{
 return typeof value==="number"&&Number.isFinite(value)&&value>0&&value<50000;
}
export function localLungFacts(evidence:SegmentationEvidence):LocalLungFacts{
  if(evidence.schema!=="opus-specialist-evidence/v1"||
     evidence.producer.kind!=="specialist-model"||
     evidence.producer.executionMode!=="local"||
     evidence.producer.model.id!=="lungmask-R231"||
     evidence.producer.model.version!=="0.2.20"||
     evidence.producer.model.weightsSha256!==SHA||
     evidence.source.modality!=="CT"||
     evidence.clinicalStatus!=="unverified_research_draft"||
     !Number.isSafeInteger(evidence.source.frameCount)||
     evidence.source.frameCount<3||evidence.source.frameCount>300||
     !/^[a-f0-9]{64}$/.test(evidence.source.inputSha256)||
     !/^[a-f0-9]{64}$/.test(evidence.mask.sha256))
    throw Error("R231 source-bound local model evidence required");
  const obs=evidence.observations;
  if(!Array.isArray(obs)||obs.length!==2||
     new Set(obs.map(o=>o.labelId)).size!==2||
     obs.some(o=>o.kind!=="segmentation-measurement"||!finiteVolume(o.volumeMl)))
    throw Error("Both R231 lung labels must be present; no missing-lung conclusion");
  const right=obs.find(o=>o.labelId===1),left=obs.find(o=>o.labelId===2);
  if(!right||!left)throw Error("R231 requires original left and right label mapping");
  return {schema:"opus-local-r231-facts/v1",model:"lungmask-R231",
    frameCount:evidence.source.frameCount,rightLungMaskMl:right.volumeMl,
    leftLungMaskMl:left.volumeMl,coverage:"not-clinically-verified",
    masksAreNotPathologyDetectors:true};
}
/** Server revalidates the exact narrow payload rather than trusting browser
 * claims about coverage or accepting arbitrary clinical/patient text.
 */
export function parseLocalLungFacts(raw:unknown):LocalLungFacts{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("invalid_local_lung_input");
 const v=raw as Record<string,unknown>;
 const keys=["schema","model","frameCount","rightLungMaskMl","leftLungMaskMl","coverage","masksAreNotPathologyDetectors"];
 if(Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k))||
    v.schema!=="opus-local-r231-facts/v1"||v.model!=="lungmask-R231"||
    typeof v.frameCount!=="number"||!Number.isSafeInteger(v.frameCount)||Number(v.frameCount)<3||Number(v.frameCount)>300||
    !finiteVolume(v.rightLungMaskMl)||!finiteVolume(v.leftLungMaskMl)||
    v.coverage!=="not-clinically-verified"||
    v.masksAreNotPathologyDetectors!==true)
    throw Error("invalid_local_lung_input");
 return v as LocalLungFacts;
}
export function parseLocalLungReview(content:string):LocalLungReview{
 if(content.length>5000)throw Error("local_llm_output_too_large");
 const normalized=content.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
 const x:unknown=JSON.parse(normalized);
 if(!x||typeof x!=="object"||Array.isArray(x))throw Error("invalid_local_llm_output");
 const v=x as Record<string,unknown>;
 const valid=(a:unknown,maxN:number)=>Array.isArray(a)&&a.length<=maxN&&
   a.every(x=>typeof x==="string"&&x.length>0&&x.length<=300);
 if(v.schema!=="opus-local-lung-llm-review/v1"||
    typeof v.summary!=="string"||v.summary.length<8||v.summary.length>700||
    !valid(v.qualityQuestions,6)||!valid(v.limitations,6)||
    (v.limitations as unknown[]).length===0)
    throw Error("invalid_local_llm_output");
 return v as LocalLungReview;
}
