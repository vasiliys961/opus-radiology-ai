/** A readable Russian radiology protocol is the physician's PRIMARY output.
 * Structured observations / model numbers remain technical evidence behind it.
 * Never imply a four-image sample is a full CT/MRI interpretation.
 */
export type RadiologistProtocol={
 schema:"opus-radiologist-protocol/v1";
 technique:string;
 description:string;
 conclusion:string;
 recommendations:string;
 assessmentScope:"sampled_frames_only";
 physicianReviewRequired:true;
};
const readable=(v:unknown,max:number):v is string=>
 typeof v==="string"&&v.trim().length>=12&&v.length<=max;
export function validateRadiologistProtocol(v:unknown):v is RadiologistProtocol{
 if(!v||typeof v!=="object"||Array.isArray(v))return false;
 const x=v as Partial<RadiologistProtocol>;
 return Object.keys(x).sort().join(",")===
  ["schema","technique","description","conclusion","recommendations",
   "assessmentScope","physicianReviewRequired"].sort().join(",")&&
  x.schema==="opus-radiologist-protocol/v1"&&
  readable(x.technique,1000)&&readable(x.description,3500)&&
  readable(x.conclusion,1700)&&readable(x.recommendations,1400)&&
  x.assessmentScope==="sampled_frames_only"&&x.physicianReviewRequired===true;
}
export function formatRadiologistProtocol(
 protocol:RadiologistProtocol,modality:"CT"|"MR"|"CR"|"DX",
):string{
 if(!validateRadiologistProtocol(protocol))throw Error("invalid_radiologist_protocol");
 const heading=modality==="CT"?"КТ":modality==="MR"?"МРТ":"Рентгенография";
 return [
  heading+" — предварительный протокол описания (для проверки врачом)",
  "",
  "МЕТОДИКА",
  protocol.technique.trim(),"",
  "ОПИСАНИЕ",
  protocol.description.trim(),"",
  "ЗАКЛЮЧЕНИЕ",
  protocol.conclusion.trim(),"",
  "РЕКОМЕНДАЦИИ",
  protocol.recommendations.trim(),"",
  "Статус: черновик; оцениваемый охват — только выбранные изображения.",
  "Окончательное заключение формирует и подписывает врач-рентгенолог.",
 ].join("\n");
}
