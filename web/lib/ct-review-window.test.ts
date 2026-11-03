import test from 'node:test';
import assert from 'node:assert/strict';
import {ctReviewWindow,validCtReviewWindow,requireCtReviewCalibration} from './ct-review-window.ts';
import {windowDecodedPlane} from './decoded-vision-preview.ts';
test('CT presets change display of the same source samples, not source values',()=>{
 const source=new Int16Array([-900,-600,0,40,1000]);const before=[...source];
 const lung=ctReviewWindow('LUNG','CT'),soft=ctReviewWindow('SOFT','CT');
 const a=windowDecodedPlane(source,5,1,5,1,0,lung.center,lung.width,false);
 const b=windowDecodedPlane(source,5,1,5,1,0,soft.center,soft.width,false);
 assert.notDeepEqual(a,b);assert.deepEqual([...source],before);
 assert.equal(validCtReviewWindow('patientName'),false);
 assert.throws(()=>ctReviewWindow('LUNG','MR'));
});

test('HU presets refuse an uncalibrated CT or MR instead of guessing quantitative units',()=>{
 assert.doesNotThrow(()=>requireCtReviewCalibration({modality:'MR'},'SOURCE'));
 assert.throws(()=>requireCtReviewCalibration({modality:'CT'},'LUNG'));
 assert.throws(()=>requireCtReviewCalibration({modality:'MR',rescaleUnit:'HU',rescaleSlope:1,rescaleIntercept:0},'BRAIN'));
 assert.doesNotThrow(()=>requireCtReviewCalibration({modality:'CT',rescaleUnit:'HU',rescaleSlope:1,rescaleIntercept:-1000},'LUNG','SOFT'));
});
