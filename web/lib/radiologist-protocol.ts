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
/** Standard report structure depends on the ACTUAL study region, not an LLM guess. */
export type RadiologyStudyRegion="chest"|"abdomen"|"brain"|null;
export function standardRadiologistSections(
 modality:"CT"|"MR"|"CR"|"DX",region:RadiologyStudyRegion,
):readonly string[]{
 if(modality==="CR"||modality==="DX")return [
  "Легочные поля","Плевральные полости","Сердечно-сосудистая тень","Костные структуры",
 ];
 if(region==="chest")return [
  "Легкие и бронхи","Плевра","Средостение и лимфатические узлы",
  "Сердце и сосуды","Костные структуры и мягкие ткани",
 ];
 if(region==="abdomen")return [
  "Печень и желчные пути","Поджелудочная железа и селезенка",
  "Почки и надпочечники","Кишечник и брюшина",
  "Сосуды и лимфатические узлы","Костные структуры",
 ];
 if(region==="brain")return [
  "Вещество головного мозга","Желудочковая система и ликворные пространства",
  "Срединные структуры","Сосудистые структуры","Околоносовые пазухи и кости черепа",
 ];
 return [];
}
export function validateStandardAnatomicalDescription(
 protocol:RadiologistProtocol,modality:"CT"|"MR"|"CR"|"DX",
 region:RadiologyStudyRegion,
):boolean{
 if(!validateRadiologistProtocol(protocol))return false;
 const sections=standardRadiologistSections(modality,region);
 // Exact headings anchor an ordinary Russian radiology report and make absent
 // structures visibly unassessed instead of silently omitted.
 return sections.every(heading=>protocol.description.includes(heading+":"));
}
const readable=(v:unknown,max:number):v is string=>
 typeof v==="string"&&v.trim().length>=12&&v.length<=max;
export function validateRadiologistProtocol(v:unknown):v is RadiologistProtocol{
 if(!v||typeof v!=="object"||Array.isArray(v))return false;
 const x=v as Partial<RadiologistProtocol>;
 return Object.keys(x).sort().join(",")===
  ["schema","technique","description","conclusion","recommendations",
   "assessmentScope","physicianReviewRequired"].sort().join(",")&&
  x.schema==="opus-radiologist-protocol/v1"&&
  readable(x.technique,1300)&&readable(x.description,5500)&&
  readable(x.conclusion,2500)&&readable(x.recommendations,2000)&&
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
