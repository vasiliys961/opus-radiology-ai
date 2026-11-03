/** Local-only binding of already SHA/affine-verified ORIGINAL CLN candidates.
 * MONAI voxel hypotheses and aggregate counts cannot enter this contract.
 */
import type {DicomSeries} from './dicom-series.ts';
import type {ClnVerifiedLocalEvidence} from './cln-physician-local-review.ts';
export type BoundDetectorRecheck={candidateId:number;sourceIndex:number;xFraction:number;yFraction:number};
export function clnDetectorRecheck(series:DicomSeries,evidence:ClnVerifiedLocalEvidence|null):BoundDetectorRecheck[]{
 if(!evidence)return [];
 const dims=evidence.dimensions;
 if(series.modality!=='CT'||!series.volumeReady||!series.spatiallySorted||!Array.isArray(dims)||dims.length!==3||
 dims.some(n=>!Number.isSafeInteger(n)||n<1)||dims[2]!==series.members.length||
 !/^[a-f0-9]{64}$/.test(evidence.sourceNiftiSha256)||!Array.isArray(evidence.candidates)||evidence.candidates.length>250||
 series.members.some(m=>m.metadata.columns!==dims[0]||m.metadata.rows!==dims[1]))throw Error('CLN source grid does not match selected DICOM series');
 const seen=new Set<number>();
 return evidence.candidates.map(c=>{
  const p=c.sourceVoxelCentroidIJK;
  if(!Number.isSafeInteger(c.componentId)||c.componentId<1||seen.has(c.componentId)||
   !Array.isArray(p)||p.length!==3||p.some((v,i)=>!Number.isFinite(v)||v<0||v>dims[i]-1)||
   !Number.isSafeInteger(c.sliceIndex)||c.sliceIndex!==Math.round(p[2])||
   series.members[c.sliceIndex]?.metadata.sopInstanceUid!==c.sopInstanceUid||
   !Number.isFinite(c.candidateVolumeMl)||c.candidateVolumeMl<=0)throw Error('CLN candidate has no verified current source slice');
  seen.add(c.componentId);
  return {candidateId:c.componentId,sourceIndex:c.sliceIndex,xFraction:(p[0]+.5)/dims[0],yFraction:(p[1]+.5)/dims[1]};
 });
}
