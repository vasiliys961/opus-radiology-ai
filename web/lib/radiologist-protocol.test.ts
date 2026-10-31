import test from "node:test";
import assert from "node:assert/strict";
import {formatRadiologistProtocol,standardRadiologistSections,
 validateStandardAnatomicalDescription,type RadiologistProtocol} from "./radiologist-protocol.ts";

const chest:RadiologistProtocol={
 schema:"opus-radiologist-protocol/v1",
 technique:"КТ органов грудной клетки; для исследования доступны только четыре аксиальных изображения.",
 description:standardRadiologistSections("CT","chest")
  .map((name,i)=>name+": "+(i===0?
   "На доступных изображениях определяется очаг с неровным контуром.":
   "По представленным изображениям отдел достоверно не оценивается.")).join(" "),
 conclusion:"Очаговое образование лёгкого, требует дальнейшего уточнения.",
 recommendations:"Необходим просмотр полного исходного исследования и сравнение с предыдущими КТ.",
 assessmentScope:"sampled_frames_only",physicianReviewRequired:true,
};
test("ordinary CT protocol must have lungs, pleura, mediastinum, heart and bones",()=>{
 assert.ok(validateStandardAnatomicalDescription(chest,"CT","chest"));
 const text=formatRadiologistProtocol(chest,"CT");
 assert.match(text,/МЕТОДИКА[\s\S]*ОПИСАНИЕ[\s\S]*ЗАКЛЮЧЕНИЕ[\s\S]*РЕКОМЕНДАЦИИ/);
 for(const h of standardRadiologistSections("CT","chest"))
  assert.ok(text.includes("\n\n"+h+":"),"Each organ should be on its own paragraph: "+h);
 assert.doesNotMatch(text,/PatientName|SOPInstanceUID|StudyInstanceUID/);
 assert.match(text,/По представленным изображениям отдел достоверно не оценивается/);
});
test("MR brain and CT abdomen have distinct required anatomical sections",()=>{
 const brain=standardRadiologistSections("MR","brain");
 const abdomen=standardRadiologistSections("CT","abdomen");
 assert.ok(brain.some(x=>x.includes("Вещество головного мозга")));
 assert.ok(abdomen.some(x=>x.includes("Печень")));
 assert.notDeepEqual(brain,abdomen);
 assert.ok(!validateStandardAnatomicalDescription(chest,"MR","brain"));
 assert.ok(!validateStandardAnatomicalDescription({...chest,
  description:"Легкие и бронхи: только этот отдел визуализирован."},"CT","chest"));
});
