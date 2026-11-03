import {validCtReviewWindow,type CtReviewWindow} from './ct-review-window.ts';
/** Outbound technical allowlist. Never include raw DICOM strings or clinical free text. */
import type {DicomSeries} from './dicom-series.ts';
export type VolumeTechnicalContext={
 window?:CtReviewWindow;additionalWindow?:CtReviewWindow;
 region:'HEAD'|'NECK'|'CHEST'|'ABDOMEN'|'PELVIS'|'SPINE'|'EXTREMITY'|'UNKNOWN';
 sliceSpacingMm:number|null;pixelSpacingMm:[number,number]|null;
 contrast:'DECLARED'|'UNKNOWN';phase:'UNKNOWN';mrWeighting:'UNKNOWN';
 mrSequenceCodes:('SE'|'GR'|'IR'|'EP')[];
};
const regions=['HEAD','NECK','CHEST','ABDOMEN','PELVIS','SPINE','EXTREMITY','UNKNOWN'];
const positive=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=1000;
export function validVolumeTechnicalContext(value:unknown):value is VolumeTechnicalContext{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as VolumeTechnicalContext;
 return Object.keys(v).every(k=>['contrast','mrSequenceCodes','mrWeighting','phase','pixelSpacingMm','region','sliceSpacingMm','window','additionalWindow'].includes(k))&&
 ['contrast','mrSequenceCodes','mrWeighting','phase','pixelSpacingMm','region','sliceSpacingMm'].every(k=>Object.hasOwn(v,k))&&
 (v.window===undefined||validCtReviewWindow(v.window))&&(v.additionalWindow===undefined||validCtReviewWindow(v.additionalWindow))&&
 regions.includes(v.region)&&['DECLARED','UNKNOWN'].includes(v.contrast)&&v.phase==='UNKNOWN'&&v.mrWeighting==='UNKNOWN'&&
 (v.sliceSpacingMm===null||positive(v.sliceSpacingMm))&&
 (v.pixelSpacingMm===null||Array.isArray(v.pixelSpacingMm)&&v.pixelSpacingMm.length===2&&v.pixelSpacingMm.every(positive))&&
 Array.isArray(v.mrSequenceCodes)&&v.mrSequenceCodes.length<=4&&new Set(v.mrSequenceCodes).size===v.mrSequenceCodes.length&&
 v.mrSequenceCodes.every(c=>['SE','GR','IR','EP'].includes(c));
}
export function volumeTechnicalContext(series:DicomSeries):VolumeTechnicalContext{
 const m=series.members.map(x=>x.metadata),first=m[0];
 const region=first?.bodyRegion&&m.every(x=>x.bodyRegion===first.bodyRegion)?first.bodyRegion:'UNKNOWN';
 const spacing=first?.pixelSpacing;
 const pixelSpacingMm=spacing&&spacing.every(positive)&&m.every(x=>x.pixelSpacing?.every((n,i)=>n===spacing[i]))?spacing:null;
 const codes=(first?.mrSequenceCodes??[]).filter(c=>m.every(x=>x.mrSequenceCodes?.includes(c)));
 return {region,sliceSpacingMm:positive(series.sliceSpacingMm)?series.sliceSpacingMm:null,pixelSpacingMm,
 contrast:m.length>0&&m.every(x=>x.contrastAgentDeclared===true)?'DECLARED':'UNKNOWN',
 phase:'UNKNOWN',mrWeighting:'UNKNOWN',mrSequenceCodes:[...new Set(codes)]};
}
