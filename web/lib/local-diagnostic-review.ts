/** Source-linked, physician-authored LOCAL differential. No inference, signing,
 * server storage, upload, remote LLM or manufactured absence-of-disease claims.
 */
import type {BoundFinding} from "./ai-review.ts";
import {evaluateLocalDiagnosticReview} from "./patient-cloud-policy.ts";

export type LocalDiagnosticDraftInput={
  modality:"CT"|"MR";
  sourceBound:boolean; sourceChanged:boolean;
  aiResultSha256:string;
  findings:readonly BoundFinding[];
  decisions:Readonly<Record<string,"recheck"|"dismiss"|undefined>>;
  differentials:Readonly<Record<string,string|undefined>>;
  clinicalQuestion:string;
  clinicianSynthesis:string;
};
export type LocalDiagnosticDraft={
  schema:"opus-local-diagnostic-draft/v1";
  status:"unverified-unsigned-review";
  source:{modality:"CT"|"MR";aiResultSha256:string;sourceBound:true;studyCoverageVerified:false};
  reviewerIdentity:"not-authenticated";
  clinicalQuestion:string;
  clinicianSynthesis:string;
  observations:{findingId:string;anatomy:string;sign:string;memberId:string;
    decision:"candidate"|"recheck"|"dismiss";differential:string;needsRecheck:boolean}[];
  automaticDiagnosis:false;
  excludesUnobservedDisease:false;
  externalTransmission:false;
  limitations:string[];
};
function clean(value:string,limit:number,name:string,required=false){
  if(typeof value!=="string"||value.length>limit||value.includes("\u0000")||
     (required&&!value.trim()))throw Error("Некорректное поле: "+name);
  return value.trim();
}
export function buildLocalDiagnosticDraft(input:LocalDiagnosticDraftInput):LocalDiagnosticDraft{
  const access=evaluateLocalDiagnosticReview(input);
  if(!access.permitted)throw Error(access.reason);
  if(!/^[a-f0-9]{64}$/.test(input.aiResultSha256))throw Error("SHA-256 исходного AI-паспорта недоступна.");
  if(!Array.isArray(input.findings)||input.findings.length>128)throw Error("Слишком много AI-находок.");
  const seen=new Set<string>();
  const observations=input.findings.map(f=>{
    if(!f||seen.has(f.findingId))throw Error("Дублирующаяся AI-находка.");
    seen.add(f.findingId);
    const decision=input.decisions[f.findingId]??"candidate";
    if(!["candidate","recheck","dismiss"].includes(decision))throw Error("Неверный статус наблюдения.");
    return {
      findingId:clean(f.findingId,160,"findingId",true),
      anatomy:clean(f.anatomy,300,"anatomy",true),
      sign:clean(f.sign,1800,"sign",true),
      memberId:clean(f.memberId,160,"memberId",true),
      decision,
      differential:clean(input.differentials[f.findingId]??"",1200,"differential"),
      needsRecheck:f.needsRecheck,
    };
  });
  return {
    schema:"opus-local-diagnostic-draft/v1",
    status:"unverified-unsigned-review",
    source:{modality:input.modality,aiResultSha256:input.aiResultSha256,
      sourceBound:true,studyCoverageVerified:false},
    reviewerIdentity:"not-authenticated",
    clinicalQuestion:clean(input.clinicalQuestion,1000,"clinicalQuestion"),
    clinicianSynthesis:clean(input.clinicianSynthesis,4000,"clinicianSynthesis",true),
    observations,
    automaticDiagnosis:false,excludesUnobservedDisease:false,
    externalTransmission:false,
    limitations:[
      "Текст составляет локальный пользователь; квалификация и личность автора не подтверждены.",
      "AI-находки предварительные; отсутствие наблюдений не исключает патологию.",
      "Совпадение SOP UID с открытой серией не подтверждает полноту исследования или правильность AI-результата.",
      "Черновик не является подписанным клиническим заключением и не отправляется в облако.",
    ],
  };
}
