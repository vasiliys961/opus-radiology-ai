import test from 'node:test';
import assert from 'node:assert/strict';
import {clnDetectorRecheck} from './cln-detector-recheck.ts';
import type {DicomSeries} from './dicom-series.ts';
import type {ClnVerifiedLocalEvidence} from './cln-physician-local-review.ts';
const series={modality:'CT',volumeReady:true,spatiallySorted:true,members:Array.from({length:4},(_,i)=>({metadata:{columns:64,rows:32,sopInstanceUid:'1.2.'+i}}))} as unknown as DicomSeries;
const evidence:ClnVerifiedLocalEvidence={sourceNiftiSha256:'a'.repeat(64),dimensions:[64,32,4],candidates:[{componentId:1,candidateVolumeMl:1,sourceVoxelCentroidIJK:[20,10,2.1],sliceIndex:2,sopInstanceUid:'1.2.2'}]};
test('verified native CLN centroid binds to exact current DICOM SOP and source pixels',()=>{
 assert.deepEqual(clnDetectorRecheck(series,evidence),[{candidateId:1,sourceIndex:2,xFraction:20.5/64,yFraction:10.5/32}]);
 assert.deepEqual(clnDetectorRecheck(series,null),[]);
});
test('foreign SOP, wrong geometry, guessed slice and invalid centroid fail closed',()=>{
 for(const c of [{...evidence.candidates[0],sopInstanceUid:'other'}, {...evidence.candidates[0],sliceIndex:1},
 {...evidence.candidates[0],sourceVoxelCentroidIJK:[64,10,2.1] as [number,number,number]}])assert.throws(()=>clnDetectorRecheck(series,{...evidence,candidates:[c]}));
 assert.throws(()=>clnDetectorRecheck(series,{...evidence,dimensions:[32,64,4]}));
 assert.throws(()=>clnDetectorRecheck(series,{...evidence,candidates:[evidence.candidates[0],evidence.candidates[0]]}));
});
