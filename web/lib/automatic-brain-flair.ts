/** Conservative, provenance-bound DICOM parameter evidence for T2-FLAIR.
 *
 * TR/TE/TI alone do not identify every manufacturer's sequence, so this is
 * a restricted automatic candidate for the research WMH runner, never a
 * universal MR sequence classifier or a claim of diagnostic validation.
 * Ambiguous/missing parameters are routed to independent Vision instead.
 */
import type {DicomSeries} from "./dicom-series.ts";
import {planVisionFrameSamples} from "./vision-frame-plan.ts";

export type AutoFlairAssessment={
 eligible:boolean;
 reason:string;
 parameters?:{trMs:number;teMs:number;tiMs:number};
};
export function assessAutomaticBrainFlair(series:DicomSeries):AutoFlairAssessment{
 const fail=(reason:string):AutoFlairAssessment=>({eligible:false,reason});
 if(series.modality!=="MR"||!series.volumeReady||!series.spatiallySorted||
    series.members.length<8||series.members.length>300||
    series.members.some(m=>m.metadata.modality!=="MR"||
      m.metadata.bodyRegion!=="HEAD"||
      m.metadata.imageRole==="LOCALIZER"||m.metadata.imageRole==="DERIVED"))
  return fail("Нужна исходная объёмная МРТ головы, без локализатора и реконструкции.");
 // Reuse the established geometry, Study/Series/SOP/Frame-of-Reference
 // integrity gate instead of trusting a descriptive protocol filename.
 if(planVisionFrameSamples([series],series.key).status!=="ready-for-local-preview")
  return fail("Не подтверждены исходные UID и физическая геометрия серии.");
 const first=series.members[0].metadata;
 const tr=first.repetitionTimeMs,te=first.echoTimeMs,ti=first.inversionTimeMs;
 if(tr==null||te==null||ti==null||
    !Number.isFinite(tr)||!Number.isFinite(te)||!Number.isFinite(ti))
  return fail("TR/TE/TI отсутствуют: FLAIR нельзя назначить автоматически.");
 // Narrow adult long-inversion T2-FLAIR corridor. Short inversion STIR and
 // T1 MPRAGE cannot satisfy all three simultaneously. This does not
 // attempt to infer manufacturer-specific 3D FLAIR from filenames.
 if(tr<5500||tr>16000||te<70||te>250||ti<1500||ti>3500)
  return fail("TR/TE/TI не подтверждают длинную T2-FLAIR-подобную инверсию.");
 const consistent=series.members.every(member=>{
  const m=member.metadata;
  const within=(value:number|null|undefined,reference:number)=>
    value!=null&&Number.isFinite(value)&&
    Math.abs(value-reference)<=Math.max(5,reference*0.01);
  return within(m.repetitionTimeMs,tr)&&within(m.echoTimeMs,te)&&
   within(m.inversionTimeMs,ti);
 });
 if(!consistent)return fail("Различные TR/TE/TI внутри серии: автоматическая классификация запрещена.");
 return {eligible:true,
  reason:"DICOM TR/TE/TI совместимы с длинной T2-FLAIR; оригинальная модель WMH может быть предложена автоматически.",
  parameters:{trMs:tr,teMs:te,tiMs:ti}};
}
