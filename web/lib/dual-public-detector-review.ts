/**
 * Two independent, source-fact-anchored LLM reviews of genuine existing public
 * CT pretrained-model evidence. No browser-provided pixels or patient facts.
 *
 * This is a diagnostic research review of pinned public model outputs, not a
 * patient or DICOM cloud release. Never infer diagnosis or vote away conflict.
 */
import {parsePublicLLMReview,type PublicResearchCase,type PublicLLMReview} from "./public-case-evidence.ts";
import {readCompletionText} from "./vision-orchestra.ts";
import type {AiProvider,AiGatewayRequest} from "./ai-gateway.ts";

export const GEMINI_MODEL="google/gemini-3.8-flash";
export const OPUS_MODEL="anthropic/claude-opus-5.5";
export type Reviewer="gemini"|"opus";
type Completion={choices?:unknown};
export type ReviewCaller=(input:AiGatewayRequest,signal?:AbortSignal)=>Promise<Completion>;
export type ReviewSource={
  caseId:PublicResearchCase["caseId"];
  title:string;modelNames:string[];sourceUrl:string;
  patientStudyAnalyzed:false;clinicalValidation:false;liveInference:false;
};
export type DualPublicModelReview={
  schema:"opus-dual-public-detector-review/v1";
  source:ReviewSource;
  provider:AiProvider;
  reviews:{reviewer:Reviewer;model:string;review:PublicLLMReview}[];
  priorityConflicts:{factId:string;geminiPriority:string;opusPriority:string}[];
  notCrossValidated:string[];
  physicianReviewRequired:true;
  cloudContainsOnlyPinnedNumericalPublicEvidence:true;
  originalCTImagesTransmitted:false;
  newModelInferencePerformed:false;
  patientDataTransmitted:false;
  clinicalStatus:"unverified_research_draft";
};
const priorities=["high","medium","low"];
function factOnly(caseData:PublicResearchCase){
  if(caseData.patientStudyAnalyzed!==false||caseData.clinicalValidation!==false||
     caseData.liveInference!==false||caseData.schema!=="opus-public-model-review/v1"||
     caseData.facts.length<1||caseData.facts.length>12||
     caseData.facts.some(f=>f.id.length>100||f.detail.length>550))
    throw Error("not_pinned_pretrained_public_evidence");
  // No source identifiers, study URLs, DICOM, CT frames or free-form user text.
  return {modality:"CT_public_research",clinicalUse:false,caseId:caseData.caseId,
    observations:caseData.facts.map(f=>({factId:f.id,observation:f.detail})),
    limitations:caseData.limitations.map(t=>t.slice(0,500))};
}
function callInput(provider:AiProvider,model:string,caseData:PublicResearchCase):AiGatewayRequest{
  return {provider,role:"reasoning",model,maxTokens:1100,messages:[
    {role:"system",content:
      "Independently critique numeric EVIDENCE FROM PRETRAINED DETECTORS on a FIXED PUBLIC research CT. "+
      "No patient records or image pixels are present. Distinguish model-reported outputs from verified pathology. "+
      "Do not diagnose, infer unseen CT anatomy, invent numeric measurements or report absence of disease. "+
      "A model mask or score may be wrong; agreement between detectors is NOT expert verification. "+
      "Select ONLY supplied fact IDs. Flag unreliable evidence and missing independent gold standard. "+
      'Return STRICT JSON {"schema":"opus-public-llm-review/v1","rankedFacts":[{"factId":"known","priority":"high","reason":"why"}],"unresolvedQuestions":["text"],"summary":"qualified public research draft"}.'},
    {role:"user",content:JSON.stringify(factOnly(caseData))},
  ]};
}
export function reconcileDualReviews(caseData:PublicResearchCase,
  first:PublicLLMReview,second:PublicLLMReview):DualPublicModelReview["priorityConflicts"]{
  const known=new Set(caseData.facts.map(x=>x.id));
  const prioritiesFor=(review:PublicLLMReview)=>{
    const map=new Map<string,string>();
    for(const f of review.rankedFacts) {
      if(!known.has(f.factId)||map.has(f.factId)||!priorities.includes(f.priority))
        throw Error("unbound_detector_reviewer_fact");
      map.set(f.factId,f.priority);
    }
    return map;
  };
  const a=prioritiesFor(first),b=prioritiesFor(second);
  return [...a.entries()].flatMap(([factId,g])=>{
    const p=b.get(factId);
    return p&&p!==g?[{factId,geminiPriority:g,opusPriority:p}]:[];
  });
}
export async function reviewPublicDetectorsWithTwoLlms(
  publicCase:PublicResearchCase,provider:AiProvider,caller:ReviewCaller,signal?:AbortSignal,
):Promise<DualPublicModelReview>{
  if(provider!=="polza"&&provider!=="openrouter")throw Error("invalid_provider");
  factOnly(publicCase);
  const [gemini,opus]=await Promise.all([
    caller(callInput(provider,GEMINI_MODEL,publicCase),signal),
    caller(callInput(provider,OPUS_MODEL,publicCase),signal),
  ]);
  const a=parsePublicLLMReview(readCompletionText(gemini),publicCase);
  const b=parsePublicLLMReview(readCompletionText(opus),publicCase);
  const priorityConflicts=reconcileDualReviews(publicCase,a,b);
  const picked=new Set([...a.rankedFacts,...b.rankedFacts].map(x=>x.factId));
  return {
    schema:"opus-dual-public-detector-review/v1",
    source:{caseId:publicCase.caseId,title:publicCase.title,
      modelNames:[...publicCase.modelNames],sourceUrl:publicCase.sourceUrl,
      patientStudyAnalyzed:false,clinicalValidation:false,liveInference:false},
    provider,reviews:[
      {reviewer:"gemini",model:GEMINI_MODEL,review:a},
      {reviewer:"opus",model:OPUS_MODEL,review:b},
    ],
    priorityConflicts,
    notCrossValidated:publicCase.facts.filter(f=>!picked.has(f.id)).map(f=>f.id),
    physicianReviewRequired:true,cloudContainsOnlyPinnedNumericalPublicEvidence:true,
    originalCTImagesTransmitted:false,newModelInferencePerformed:false,
    patientDataTransmitted:false,clinicalStatus:"unverified_research_draft",
  };
}
