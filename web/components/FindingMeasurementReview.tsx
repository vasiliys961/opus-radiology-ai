"use client";
import {useState} from 'react';
import type {SeriesMember} from '../lib/dicom-series';
import type {DicomCaliperMeasurement,CtRoiMeasurement} from '../lib/dicom-lite';
import DicomCaliperPanel from './DicomCaliperPanel';
import CtHuRoiPanel from './CtHuRoiPanel';
export type AcceptedFindingMeasurement={findingKey:string;sliceNumber:number;lengthMm:number;meanHu:number|null;sourceId:string};
export default function FindingMeasurementReview({member,file,sliceNumber,findingKey,onAccept}:{member:SeriesMember;file:File|null;sliceNumber:number;findingKey:string;onAccept:(measurement:AcceptedFindingMeasurement)=>void}){
 const [length,setLength]=useState<DicomCaliperMeasurement|null>(null),[roi,setRoi]=useState<CtRoiMeasurement|null>(null);
 const ct=member.metadata.modality==='CT';
 return <section aria-label="Проверка и измерение находки врачом">
  <h3>Измерение находки · срез {sliceNumber}</h3>
  <p>Измерьте очаг на исходном изображении и сохраните измерение. Размер берётся из двух точек и PixelSpacing, плотность КТ — из выбранной области исходных пикселей. Длина на одном срезе не является объёмом очага.</p>
  <DicomCaliperPanel file={file} metadata={member.metadata} seriesKey={member.id} onSave={setLength}/>
  {ct&&<CtHuRoiPanel file={file} metadata={member.metadata} seriesKey={member.id} onSave={setRoi}/>}
  <p>Размер: {length?length.lengthMm.toFixed(2)+' мм':'не измерен'}. {ct&&'Средняя плотность: '+(roi?roi.meanHu.toFixed(2)+' HU':'не измерена')+'.'}</p>
  <button type="button" disabled={!length||ct&&!roi} onClick={()=>{
   if(!length||ct&&!roi)return;
   onAccept({findingKey,sliceNumber,lengthMm:length.lengthMm,meanHu:ct?roi!.meanHu:null,sourceId:member.id});
  }}>Принять находку с измерениями врача</button>
 </section>;
}
