/** Fail-closed eligibility for the genuine MONAI renalStructures 3-phase model.
 * DICOM ContrastBolusAgent does NOT identify arterial/venous/excretory phase.
 * Never assign phases from series ordering, series count, or image intensity.
 */
import type {DicomSeries} from "./dicom-series";

export type RenalPhaseRole="artery"|"vein"|"excret";
export type RenalThreePhaseGate={
 status:"not_assessed"|"ready_for_registration";
 reason:string;
 seriesKeys:Partial<Record<RenalPhaseRole,string>>;
};
export function verifyRenalThreePhaseStudy(
 series:ReadonlyArray<DicomSeries>,
 files:ReadonlySet<string>,
 assigned:Partial<Record<RenalPhaseRole,string>>={},
):RenalThreePhaseGate{
 const fail=(reason:string):RenalThreePhaseGate=>({status:"not_assessed",reason,seriesKeys:{}});
 const roles=["artery","vein","excret"] as const;
 if(roles.some(role=>!assigned[role]))return fail("Нет подтверждённого соответствия трёх фаз: артериальная, венозная, экскреторная. Автоматически угадать фазу из DICOM нельзя.");
 if(new Set(roles.map(role=>assigned[role])).size!==3)return fail("Одна серия не может заменять разные контрастные фазы.");
 const selected=roles.map(role=>series.find(s=>s.key===assigned[role]));
 if(selected.some(s=>!s))return fail("Одна из подтверждённых фаз отсутствует среди загруженных DICOM.");
 const volumes=selected as DicomSeries[];
 const first=volumes[0].members[0]?.metadata;
 if(!first?.studyUid||!first.frameOfReferenceUid)return fail("Не подтверждены Study UID и Frame of Reference UID.");
 for(const vol of volumes){
  if(vol.modality!=="CT"||!vol.volumeReady||!vol.spatiallySorted||vol.members.length<8)
   return fail("Требуются три исходных объёмных КТ, не локализаторы и не отдельные кадры.");
  if(vol.members.some(m=>!files.has(m.id)||m.metadata.studyUid!==first.studyUid||
     m.metadata.frameOfReferenceUid!==first.frameOfReferenceUid||
     m.metadata.bodyRegion!=="ABDOMEN"||
     m.metadata.imageRole==="DERIVED"||m.metadata.imageRole==="LOCALIZER"||
     m.metadata.rescaleUnit!=="HU"||m.metadata.rescaleSlope==null||
     m.metadata.rescaleIntercept==null))
   return fail("Фазы должны принадлежать одному исследованию и системе координат, быть исходными HU-КТ с доступными файлами.");
  const meta=vol.members[0].metadata;
  if(!meta.contrastAgentDeclared)return fail("Контрастная серия не подтверждена техническими DICOM-тегами.");
  if(vol.members.some(m=>m.metadata.rows!==meta.rows||m.metadata.columns!==meta.columns))
   return fail("Неодинаковые размеры кадров внутри фазы.");
 }
 return {status:"ready_for_registration",
   reason:"Три фазы сопоставлены по отдельным подтверждённым ролям и UID. Нужны проверка совмещения, почечный ROI и оригинальный инференс; диагноз не сформирован.",
   seriesKeys:{artery:assigned.artery,vein:assigned.vein,excret:assigned.excret}};
}
