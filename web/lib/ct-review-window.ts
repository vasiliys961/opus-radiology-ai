/** Fixed CT VOI presets. Source pixels and quantitative values are never changed. */
export const CT_REVIEW_WINDOWS={
 SOURCE:{label:'Окно из DICOM',center:null,width:null},
 BRAIN:{label:'Головной мозг · 40 / 80',center:40,width:80},
 LUNG:{label:'Лёгочное · −600 / 1500',center:-600,width:1500},
 SOFT:{label:'Мягкие ткани · 40 / 350',center:40,width:350},
 BONE:{label:'Костное · 500 / 2000',center:500,width:2000},
} as const;
export type CtReviewWindow=keyof typeof CT_REVIEW_WINDOWS;
export function validCtReviewWindow(value:unknown):value is CtReviewWindow{
 return typeof value==='string'&&Object.hasOwn(CT_REVIEW_WINDOWS,value);
}
export function ctReviewWindow(mode:CtReviewWindow,modality:string){
 if(!validCtReviewWindow(mode)||mode!=='SOURCE'&&modality!=='CT')throw Error('Окно КТ неприменимо к этой модальности.');
 return CT_REVIEW_WINDOWS[mode];
}
/** HU presets require actual source calibration; CT modality alone is insufficient. */
export function requireCtReviewCalibration(header:{modality:string;rescaleUnit?:string;rescaleSlope?:number|null;rescaleIntercept?:number|null},primary:CtReviewWindow,additional?:CtReviewWindow){
 if(primary==='SOURCE'&&!additional)return;
 if(header.modality!=='CT'||header.rescaleUnit!=='HU'||typeof header.rescaleSlope!=='number'||!Number.isFinite(header.rescaleSlope)||header.rescaleSlope<=0||
 typeof header.rescaleIntercept!=='number'||!Number.isFinite(header.rescaleIntercept))throw Error('Для окон КТ нужна подтверждённая шкала HU исходного DICOM. Выберите исходное окно или корректную КТ-серию.');
}
/** Lightweight defaults from consistent allowlisted headers, never from free text.
 * They configure display copies only and do not assert a diagnosis or phase. */
export function suggestCtReviewWindows(series:{modality:string;members:readonly {metadata:{bodyRegion?:string|null;rows:number|null;columns:number|null;rescaleUnit?:string;rescaleSlope?:number|null;rescaleIntercept?:number|null}}[]}):{primary:CtReviewWindow;additional:CtReviewWindow|'NONE'}{
 const fallback={primary:'SOURCE',additional:'NONE'} as const;
 if(series.modality!=='CT'||!series.members.length)return fallback;
 if(series.members.some(({metadata:m})=>m.rescaleUnit!=='HU'||typeof m.rescaleSlope!=='number'||!Number.isFinite(m.rescaleSlope)||m.rescaleSlope<=0||typeof m.rescaleIntercept!=='number'||!Number.isFinite(m.rescaleIntercept)))return fallback;
 const region=series.members[0].metadata.bodyRegion;
 if(!region||series.members.some(x=>x.metadata.bodyRegion!==region))return fallback;
 const pair=series.members.every(({metadata:m})=>typeof m.rows==='number'&&typeof m.columns==='number'&&m.rows>0&&m.columns>0&&m.rows*m.columns*2<=1048576);
 if(region==='CHEST')return {primary:'LUNG',additional:pair?'SOFT':'NONE'};
 if(region==='HEAD')return {primary:'BRAIN',additional:pair?'BONE':'NONE'};
 if(region==='SPINE')return {primary:'BONE',additional:pair?'SOFT':'NONE'};
 if(['ABDOMEN','PELVIS','NECK'].includes(region))return {primary:'SOFT',additional:'NONE'};
 return fallback;
}
