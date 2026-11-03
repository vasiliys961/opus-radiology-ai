import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStudySliceSelection} from './study-slice-selection.ts';
test('physician selects individual originals, inclusive ranges, de-duplicated ascending',()=>{
 assert.deepEqual(parseStudySliceSelection('150, 5, 20–23; 5 21-24',150),[4,19,20,21,22,23,149]);
 assert.deepEqual(parseStudySliceSelection('1',150),[0]);
 for(const text of ['', '0','151','9-2','1.5','1-999999999','all'])assert.throws(()=>parseStudySliceSelection(text,150));
});
