/** Verify research TotalSegmentator mask against CURRENT DICOM file bytes.
 * The unsigned passport is an integrity binding, not an attestation of model,
 * clinical validity, patient identity or provenance.
 * No DICOM bytes are uploaded, persisted or decoded here.
 */
import {sha256} from "@noble/hashes/sha2.js";
import type {DicomSeries} from "./dicom-series.ts";
import type {AnatomyProof} from "./totalseg-abdomen-import.ts";

const DIGEST=/^[a-f0-9]{64}$/;
const MAX_FRAMES=32;
const MAX_INPUT_BYTES=256*1024*1024;
const validRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const cancelled=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException("Проверка источника отменена.","AbortError");};
export type DicomSourceMatch={
  schema:"opus-totalseg-current-dicom-binding/v1";
  sourceVerified:true;
  frameCount:number;
  firstOriginalSliceIndexZeroBased:number;
  lastOriginalSliceIndexZeroBased:number;
  /** Deliberately avoid retaining source file digests/UIDs in UI metadata. */
};

async function streamedDigest(file:File,signal?:AbortSignal):Promise<string>{
  if(!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_INPUT_BYTES)
    throw Error("Размер исходного DICOM превышает допустимый предел.");
  const hash=sha256.create();
  const reader=file.stream().getReader();
  let bytes=0;
  try{
    for(;;){
      cancelled(signal);
      const {done,value}=await reader.read();
      cancelled(signal);
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>file.size||bytes>MAX_INPUT_BYTES)
        throw Error("Изменился размер исходного DICOM при чтении.");
      hash.update(value);
    }
    if(bytes!==file.size)throw Error("Исходный DICOM считан не полностью.");
    cancelled(signal);
    return Array.from(hash.digest(),n=>n.toString(16).padStart(2,"0")).join("");
  }finally{
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

/** Fail closed if the legacy mask passport contains only model/source NIfTI SHA:
 * that digest is not an identity proof for the DICOM loaded in MPR.
 */
export async function verifyResearchCurrentDicom(
  passportJson:string,
  proof:AnatomyProof,
  series:DicomSeries,
  selectedFiles:readonly File[],
  signal?:AbortSignal,
):Promise<DicomSourceMatch>{
  cancelled(signal);
  if(typeof passportJson!=="string"||new TextEncoder().encode(passportJson).length>65536)
    throw Error("Недопустимый паспорт исследовательской маски.");
  let data:unknown;
  try{data=JSON.parse(passportJson);}catch{throw Error("Не удалось прочитать паспорт источника DICOM.");}
  if(!validRecord(data)||data.sourceFullCtSha256!==proof.sourceSha256||
      data.slabMaskSha256!==proof.maskSha256||
      data.firstOriginalSliceIndexZeroBased!==proof.firstSlice||
      data.lastOriginalSliceIndexZeroBased!==proof.lastSlice)
    throw Error("Сведения о маске и паспорте источника расходятся.");
  const bound=data.sourceDicomSelectedFrameSha256;
  if(!Array.isArray(bound)||!bound.length||bound.length>MAX_FRAMES||
      bound.some(d=>typeof d!=="string"||!DIGEST.test(d)))
    throw Error("Паспорт маски не содержит SHA-256 текущих DICOM-срезов. Старый паспорт нельзя подтвердить по одной геометрии.");
  const count=proof.lastSlice-proof.firstSlice+1;
  if(count!==bound.length||count!==selectedFiles.length||count!==series.members.length||
      count>MAX_FRAMES||selectedFiles.length<3||series.modality!=="CT"||
      !series.volumeReady||!series.spatiallySorted||
      series.members.some(m=>m.metadata.modality!=="CT"||!m.metadata.sopInstanceUid))
    throw Error("Открытая CT-серия не соответствует диапазону паспортных срезов.");
  if(series.selection){
    if(series.selection.startIndex!==proof.firstSlice||
       series.selection.endIndex!==proof.lastSlice||
       series.selection.sourceFrameCount!==proof.fullDimensions[2])
      throw Error("Выбран другой диапазон исходных DICOM-срезов.");
  }else{
    // A shortened imported set without a verified original selection mapping
    // must never masquerade as slices 35-66 of a 103-frame CT.
    if(proof.firstSlice!==0||proof.lastSlice!==proof.fullDimensions[2]-1||
       proof.fullDimensions[2]!==count)
      throw Error("Не подтверждена привязка подсерии к исходным индексам.");
  }
  const sourceGrid=series.members[0].metadata;
  if(sourceGrid.rows!==proof.fullDimensions[1]||
     sourceGrid.columns!==proof.fullDimensions[0]||
     !sourceGrid.studyUid||!sourceGrid.seriesUid||!sourceGrid.frameOfReferenceUid||
     series.members.some(({metadata:m})=>
       m.studyUid!==sourceGrid.studyUid||m.seriesUid!==sourceGrid.seriesUid||
       m.frameOfReferenceUid!==sourceGrid.frameOfReferenceUid))
    throw Error("UID или сетка текущего исследования не подтверждены.");
  let total=0;
  for(let i=0;i<selectedFiles.length;i++){
    cancelled(signal);
    const file=selectedFiles[i];
    total+=file.size;
    if(!Number.isSafeInteger(total)||total>MAX_INPUT_BYTES)
      throw Error("Общий объём исходных DICOM превышает 256 МиБ.");
    const actual=await streamedDigest(file,signal);
    if(actual!==bound[i])
      throw Error("SHA-256 текущей КТ не совпадает с паспортом TotalSegmentator (срез "+(i+1)+"). Маска не загружена.");
  }
  cancelled(signal);
  return {schema:"opus-totalseg-current-dicom-binding/v1",sourceVerified:true,
    frameCount:count,firstOriginalSliceIndexZeroBased:proof.firstSlice,
    lastOriginalSliceIndexZeroBased:proof.lastSlice};
}
