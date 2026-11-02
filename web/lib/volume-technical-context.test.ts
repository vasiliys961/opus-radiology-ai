import test from 'node:test';
import assert from 'node:assert/strict';
import {validVolumeTechnicalContext,volumeTechnicalContext} from './volume-technical-context.ts';
import {validateVolumeFrameContext} from './approved-volume-batch-review.ts';
import type {DicomSeries} from './dicom-series.ts';
const clean={region:'CHEST',sliceSpacingMm:1,pixelSpacingMm:[0.7,0.7],contrast:'DECLARED',phase:'UNKNOWN',mrWeighting:'UNKNOWN',mrSequenceCodes:[]};
test('outbound technical context rejects free text, phase guesses and invalid geometry',()=>{
 assert.equal(validVolumeTechnicalContext(clean),true);
 for(const v of [{...clean,patientName:'forbidden'},{...clean,phase:'ARTERIAL'},
 {...clean,pixelSpacingMm:[0,1]},{...clean,sliceSpacingMm:Infinity},{...clean,mrWeighting:'FLAIR'},
 {...clean,mrSequenceCodes:['IR','IR']}])assert.equal(validVolumeTechnicalContext(v),false);
 assert.equal(validateVolumeFrameContext({totalFrames:9,sliceNumbers:[1,2],technical:clean},2),true);
 assert.equal(validateVolumeFrameContext({totalFrames:9,sliceNumbers:[1,2],technical:{...clean,description:'raw'}},2),false);
});
test('mixed or absent metadata stays unknown; IR alone never asserts FLAIR or contrast phase',()=>{
 const series={sliceSpacingMm:1,members:[{metadata:{bodyRegion:'HEAD',pixelSpacing:[1,1],mrSequenceCodes:['IR'],contrastAgentDeclared:true}},
  {metadata:{bodyRegion:'CHEST',pixelSpacing:[2,2],mrSequenceCodes:['IR']}}]} as unknown as DicomSeries;
 assert.deepEqual(volumeTechnicalContext(series),{region:'UNKNOWN',sliceSpacingMm:1,pixelSpacingMm:null,
 contrast:'UNKNOWN',phase:'UNKNOWN',mrWeighting:'UNKNOWN',mrSequenceCodes:['IR']});
});
