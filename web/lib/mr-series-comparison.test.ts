import test from 'node:test';
import assert from 'node:assert/strict';
import {sameMrStudy,matchMrSourcePlane} from './mr-series-comparison.ts';
import type {DicomSeries} from './dicom-series.ts';
function series(key:string,positions:number[]):DicomSeries{return {key,modality:'MR',sliceSpacingMm:2,members:positions.map((z,i)=>({id:key+i,metadata:{studyUid:'study',frameOfReferenceUid:'frame',imagePositionPatient:[0,0,z],imageOrientationPatient:[1,0,0,0,1,0]}}))} as unknown as DicomSeries;}
test('MR comparison chooses nearest physical plane, not equal instance index',()=>{
 const a=series('a',[0,2,4]),b=series('b',[-2,0,2,4]);
 assert.equal(sameMrStudy(a,b),true);assert.deepEqual(matchMrSourcePlane(a,1,b),{status:'matched',referenceIndex:2,distanceMm:0});
});
test('foreign study/frame, oblique orientation, gaps and ambiguous planes cannot be matched',()=>{
 const a=series('a',[0,2,4]);
 const foreign=series('b',[0,2,4]);foreign.members[0].metadata.studyUid='foreign';assert.equal(sameMrStudy(a,foreign),false);
 for(const b of [series('b',[9,11]),series('b',[1,3])])assert.equal(matchMrSourcePlane(a,1,b).status,'unavailable');
 const frame=series('b',[0,2,4]);frame.members[1].metadata.frameOfReferenceUid='other';assert.equal(matchMrSourcePlane(a,1,frame).status,'unavailable');
 const oblique=series('b',[0,2,4]);oblique.members[1].metadata.imageOrientationPatient=[0,1,0,0,0,1];assert.equal(matchMrSourcePlane(a,1,oblique).status,'unavailable');
});
