import test from "node:test";
import assert from "node:assert/strict";
import {hasRadiologistReportSections,SENIOR_RADIOLOGIST_PROMPT}
 from "./senior-radiologist-report.ts";

const protocol=[
 "ИССЛЕДОВАНИЕ:","КТ органов грудной клетки.",
 "МЕТОДИКА:","Исследованы отдельные аксиальные изображения; полный ряд не предоставлен.",
 "ОПИСАНИЕ:","Лёгочная паренхима: на одном из срезов виден узел с неровными контурами.",
 "Трахея и бронхи: по выборке не оценены.",
 "Средостение и внутригрудные лимфатические узлы: полноценная оценка невозможна.",
 "ЗАКЛЮЧЕНИЕ:","1. КТ-признаки узлового образования лёгкого, требуется уточнение.",
 "РЕКОМЕНДАЦИИ:","Просмотр всей серии и точное измерение узла врачом-рентгенологом.",
].join("\n");
test("Human radiology report must have correct sections and order",()=>{
 assert.equal(hasRadiologistReportSections(protocol),true);
 assert.equal(hasRadiologistReportSections(protocol.replace("МЕТОДИКА:","ТЕХНИКА:")),false);
 assert.equal(hasRadiologistReportSections(protocol.replace("ЗАКЛЮЧЕНИЕ:","ПРИМЕЧАНИЕ:")),false);
 assert.equal(hasRadiologistReportSections(protocol.replace("ЗАКЛЮЧЕНИЕ:","ЗАКЛЮЧЕНИЕ:\nSOPInstanceUID:1.2.3")),false);
});
test("Senior radiologist organ templates are modality and region-specific",()=>{
 for(const item of ["КТ ГРУДНОЙ КЛЕТКИ","Лёгочная паренхима","Плевра и плевральные полости",
  "Средостение и внутригрудные лимфатические узлы","МРТ ГОЛОВНОГО МОЗГА",
  "Желудочковая система","КТ БРЮШНОЙ ПОЛОСТИ","Печень и внутрипечёночные",
  "не оценены по представленной выборке"])
  assert.ok(SENIOR_RADIOLOGIST_PROMPT.includes(item),item);
 assert.ok(SENIOR_RADIOLOGIST_PROMPT.includes("в мл — НЕ линейный диаметр"));
});
