/** Physician's manually chosen point in a hash-verified public MetaImage CT.
 * Source MetaImage physical coordinates are not automatically DICOM LPS.
 * Manual clicks do not identify pathologies, model true positives, or diagnoses.
 */
export type SourceGeometry={
  dimensions:number[];
  spacingMm:number[];
  origin:number[];
  directionMatrix:number[][];
};
export type SourceClickPoint={
  schema:"opus-public-ct-manual-point/v1";
  kind:"physician-selected-source-pixel";
  sourceRawSha256:string;
  index3d:[number,number,number];
  metaImagePhysicalMm:[number,number,number];
  coordinateSystem:"metaimage_physical_not_verified_as_dicom_lps";
  sourcePixelsSha256Verified:true;
  seriesInstanceUid:null;
  sopInstanceUid:null;
  modelCandidateMatchVerified:false;
  diagnosisConfirmed:false;
  reviewerAuthenticated:false;
};
const finite=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x);
export function sourceClickToMetaImagePoint(
  sourceRawSha256:string,
  geometry:SourceGeometry,
  index:[number,number,number]
):SourceClickPoint {
  if(typeof sourceRawSha256!=="string"||!/^[a-f0-9]{64}$/.test(sourceRawSha256))
    throw Error("Непроверенные исходные пиксели");
  if(!Array.isArray(index)||index.length!==3||index.some(x=>!Number.isSafeInteger(x)))
    throw Error("Недостоверный индекс");
  const {dimensions,spacingMm,origin,directionMatrix}=geometry;
  if(!Array.isArray(dimensions)||dimensions.length!==3||
    dimensions.some(x=>!Number.isSafeInteger(x)||x<=0)||
    !Array.isArray(spacingMm)||spacingMm.length!==3||
    spacingMm.some(x=>!finite(x)||x<=0)||
    !Array.isArray(origin)||origin.length!==3||origin.some(x=>!finite(x))||
    !Array.isArray(directionMatrix)||directionMatrix.length!==3||
    directionMatrix.some(row=>!Array.isArray(row)||row.length!==3||row.some(x=>!finite(x))))
    throw Error("Недостоверная геометрия MetaImage");
  if(index.some((x,i)=>x<0||x>=dimensions[i]))throw Error("Точка за пределами исходной КТ");
  const coords:[number,number,number]=[0,1,2].map(row=>
    origin[row]+[0,1,2].reduce((sum,col)=>
      sum+directionMatrix[row][col]*spacingMm[col]*index[col],0)
  ) as [number,number,number];
  if(coords.some(x=>!Number.isFinite(x)))throw Error("Ошибка преобразования физической точки");
  return {
    schema:"opus-public-ct-manual-point/v1",kind:"physician-selected-source-pixel",
    sourceRawSha256,index3d:[...index],metaImagePhysicalMm:coords,
    coordinateSystem:"metaimage_physical_not_verified_as_dicom_lps",
    sourcePixelsSha256Verified:true,seriesInstanceUid:null,sopInstanceUid:null,
    modelCandidateMatchVerified:false,diagnosisConfirmed:false,reviewerAuthenticated:false,
  };
}
