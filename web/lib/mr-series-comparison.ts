/** Nearest parallel source plane in the SAME study/frame of reference.
 * This is local navigation, not deformable registration or proof of equal anatomy.
 */
import type {DicomSeries,TechnicalDicomMetadata} from './dicom-series.ts';
function normal(m:TechnicalDicomMetadata){
 const o=m.imageOrientationPatient;if(!o||o.length!==6||o.some(n=>!Number.isFinite(n)))return null;
 const n=[o[1]*o[5]-o[2]*o[4],o[2]*o[3]-o[0]*o[5],o[0]*o[4]-o[1]*o[3]],size=Math.hypot(...n);
 return size>0.999&&size<1.001?n.map(v=>v/size):null;
}
export function sameMrStudy(a:DicomSeries,b:DicomSeries){
 const study=a.members[0]?.metadata.studyUid;
 return a.modality==='MR'&&b.modality==='MR'&&a.key!==b.key&&!!study&&b.members.length>0&&
 [...a.members,...b.members].every(x=>x.metadata.studyUid===study);
}
export function matchMrSourcePlane(a:DicomSeries,index:number,b:DicomSeries):
 {status:'matched';referenceIndex:number;distanceMm:number}|{status:'unavailable';reason:string}{
 if(!sameMrStudy(a,b))return {status:'unavailable',reason:'Серии не принадлежат одному подтверждённому МР-исследованию.'};
 const source=a.members[index]?.metadata,frame=source?.frameOfReferenceUid,n=source&&normal(source),p=source?.imagePositionPatient;
 if(!frame||!n||!p||p.length!==3||p.some(v=>!Number.isFinite(v)))return {status:'unavailable',reason:'Нет подтверждённой геометрии исходного среза.'};
 let best=-1,distance=Infinity,tied=false;
 for(const [i,item] of b.members.entries()){
  const m=item.metadata,q=m.imagePositionPatient,other=normal(m);
  if(m.frameOfReferenceUid!==frame||!q||q.length!==3||q.some(v=>!Number.isFinite(v))||!other||Math.abs(n.reduce((s,v,k)=>s+v*other[k],0))<0.999)
   return {status:'unavailable',reason:'Системы координат или направления серий различаются. Автоматическое сопоставление не выполняется.'};
  const d=Math.abs(q.reduce((s,v,k)=>s+(v-p[k])*n[k],0));
  if(d<distance-0.001){best=i;distance=d;tied=false;}else if(Math.abs(d-distance)<0.001)tied=true;
 }
 const tolerance=Math.min(5,Math.max(0.5,(b.sliceSpacingMm??0)/2));
 if(best<0||distance>tolerance||tied)return {status:'unavailable',reason:'Однозначный близкий параллельный срез не найден.'};
 return {status:'matched',referenceIndex:best,distanceMm:distance};
}
