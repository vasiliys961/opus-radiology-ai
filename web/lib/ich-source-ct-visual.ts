/** Source-native head CT ICH review. Never assume a model heatmap IS a bleed.
 * Browser-local source pixels ONLY; no server upload, image resampling or
 * inference. Geometric projection must agree with the actually loaded NIfTI
 * original affine and preexisting source-bound research model proposal.
 */
import {transformPoint,type Affine} from "./segmentation-mask.ts";
import type {NiftiCtSource,NativeCtSlab} from "./nifti-ct-review.ts";
import type {IchAlternativeCandidate,IchAlternativeReport} from "./ianpan-ich-report.ts";

const MAX_NATIVE_SLICE_BYTES=512*512*4;
export type SourceIchBox={
  subtype:IchAlternativeCandidate["class"];
  modelSourceSliceIndex:number;
  sourceVoxelBoundingBoxXYZ:[number,number,number,number,number,number];
  rawUncalibratedScore:number;
  clinicalHemorrhageConfirmed:false;
};

const near=(x:number,y:number)=>Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=0.35;
export function validateIchSourceNativeGeometry(
  report:IchAlternativeReport,source:NiftiCtSource
):SourceIchBox[]{
  if(report.readyForClinicalUse!==false||
     report.modelInputHeatmapsAreSourceAligned!==false||
     report.source.researchRoiClinicalValidation!==false||
     report.source.researchRoiVoxelGeometryProjectionAvailable!==true||
     source.dimensions.length!==3||
     source.dimensions.some((n,i)=>n!==report.source.sourceDimensionsXYZ[i])||
     report.source.modelOrderedSliceCount<1||
     report.source.modelOrderedSliceCount>source.dimensions[2])
    throw Error("Не совпадает оригинальный объём КТ и исследовательский источник.");
  const result:SourceIchBox[]=[];
  for(const c of report.candidates){
    if(c.class==="any")continue; // Do NOT count class 'any' as separate hematoma.
    const roi=c.sourceVoxelProjection;
    if(!roi)continue; // No mapped source ROI: no invented clinical lesion.
    const dims=source.dimensions,b=roi.boundingBoxNativeNiftiXYZ;
    if(b.length!==6||b.some((v,i)=>
       !Number.isSafeInteger(v)||v<0||v>=dims[i%3])||
       b.slice(0,3).some((x,i)=>x>b[i+3])||
       b[2]!==b[5]||
       roi.independentlyClinicallyVerified!==false||
       roi.expertMaskCompared!==false)
      throw Error("Предложенная моделью область выходит за оригинальные воксели.");
    const corners:number[][]=[];
    for(const x of [b[0],b[3]])for(const y of [b[1],b[4]])
      for(const z of [b[2],b[5]]){
        const lps=transformPoint(source.affineLps,[x,y,z]);
        corners.push([-lps[0],-lps[1],lps[2]]);
      }
    const world=[
      ...[0,1,2].map(i=>Math.min(...corners.map(p=>p[i]))),
      ...[0,1,2].map(i=>Math.max(...corners.map(p=>p[i]))),
    ];
    if(!world.every((v,i)=>near(v,roi.boundingBoxWorldRasMm[i])))
      throw Error("Физическая ориентация исходной КТ не совпала с модельной областью.");
    result.push({
      subtype:c.class,modelSourceSliceIndex:b[2],
      sourceVoxelBoundingBoxXYZ:b,rawUncalibratedScore:c.rawUncalibratedScore,
      clinicalHemorrhageConfirmed:false,
    });
  }
  return result;
}

/** One true NIfTI native-index slice after caller has SHA-verified WHOLE file.
 * Original floating-point values preserved; no DICOM or HU calibration claim.
 */
export async function readVerifiedIchNativeSlice(
 file:Blob,source:NiftiCtSource,sha:string,index:number,
 signal?:AbortSignal
):Promise<NativeCtSlab>{
  if(!/^[a-f0-9]{64}$/.test(sha)||
     !Number.isSafeInteger(index)||index<0||index>=source.dimensions[2]||
     source.dimensions[0]>512||source.dimensions[1]>512||
     source.bytesPerVoxel!==2&&source.bytesPerVoxel!==4)
    throw Error("Некорректная индексная плоскость исходной NIfTI.");
  if(signal?.aborted)throw Error("Чтение КТ отменено.");
  const planeSize=source.dimensions[0]*source.dimensions[1];
  const byteSize=planeSize*source.bytesPerVoxel;
  if(byteSize>MAX_NATIVE_SLICE_BYTES)throw Error("Срез превышает ограничение памяти.");
  const offset=352+index*byteSize;
  if(offset+byteSize>file.size)
    throw Error("Исходный файл КТ обрезан.");
  const bytes=await file.slice(offset,offset+byteSize).arrayBuffer();
  if(signal?.aborted)throw Error("Чтение КТ отменено.");
  if(bytes.byteLength!==byteSize)throw Error("Неполный исходный срез КТ.");
  const pixels=source.datatype===16?new Float32Array(bytes):new Int16Array(bytes);
  for(const scalar of pixels)if(!Number.isFinite(scalar))throw Error("Некорректный исходный сигнал КТ.");
  const a=[...source.affineLps] as Affine;
  a[3]+=index*a[2];a[7]+=index*a[6];a[11]+=index*a[10];
  return {
    dimensions:[source.dimensions[0],source.dimensions[1],1],
    affineLps:a,pixels,sourceRange:[index,index],sourceSha256:sha,
  };
}
