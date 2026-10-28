import type {DicomSeries} from "./dicom-series";
export type DiagnosticPath="ich"|"wmh"|"nodule";
export type DiagnosticRoute={id:DiagnosticPath;name:string;state:"eligible"|"needs-protocol"|"not-supported";reason:string};
export function diagnosticRoutes(series:DicomSeries,availableFiles:number):DiagnosticRoute[]{
 const ready=series.volumeReady&&series.spatiallySorted&&!series.selection&&availableFiles===series.members.length;
 const region=series.members.length&&series.members.every(m=>m.metadata.bodyRegion===series.members[0].metadata.bodyRegion)
  ?series.members[0].metadata.bodyRegion:null;
 const primary=series.members.every(m=>m.metadata.imageRole!=="DERIVED"&&m.metadata.imageRole!=="LOCALIZER");
 const base=ready&&primary;
 if(series.modality==="CT"&&region==="HEAD")return [{id:"ich",name:"Кровоизлияния · ianpan",state:base&&series.members.length>=8&&series.members.length<=64?"eligible":"not-supported",
  reason:!base?"Требуется полная исходная серия с надёжной геометрией.":series.members.length<8||series.members.length>64?"Модель принимает 8–64 среза.":"Только заранее размещённая идентичная публичная серия на частном worker."}];
 if(series.modality==="MR"&&region==="HEAD")return [{id:"wmh",name:"WMH · оригинальный wmh_seg",state:base&&series.members.length>=8&&series.members.length<=512?"needs-protocol":"not-supported",
  reason:!base?"Требуется полная исходная МРТ с надёжной геометрией.":series.members.length<8||series.members.length>512?"Модель принимает 8–512 срезов.":"Нужно отдельно подтвердить FLAIR-протокол и лицензию; метаданные не доказывают FLAIR."}];
 if(series.modality==="CT"&&region==="CHEST")return [{id:"nodule",name:"Лёгочные узлы · MONAI RetinaNet",state:base?"eligible":"not-supported",
  reason:base?"Требуется локальный worker с оригинальными весами и разрешённая публичная КТ.":"Требуется полная исходная КТ с надёжной геометрией."}];
 return [];
}
