import test from 'node:test';
import assert from 'node:assert/strict';
import {standardCtRescaleUnit as unit} from './ct-standard-rescale-unit.ts';
const ct='1.2.840.10008.5.1.4.1.1.2';
test('standard original axial conventional CT permits omitted Rescale Type, not missing proof',()=>{
 for(const energy of [null,'NO'])assert.equal(unit(null,'CT',ct,'ORIGINAL\\PRIMARY\\AXIAL',energy),'HU');
 for(const [modality,cls,type,energy] of [['MR',ct,'ORIGINAL\\PRIMARY\\AXIAL',null],['CT',null,'ORIGINAL\\PRIMARY\\AXIAL',null],['CT',ct,'DERIVED\\PRIMARY\\AXIAL',null],['CT',ct,'ORIGINAL\\PRIMARY\\LOCALIZER',null],['CT',ct,null,null],['CT',ct,'ORIGINAL\\PRIMARY\\AXIAL','YES'],['CT',ct,'ORIGINAL\\PRIMARY\\AXIAL','']])assert.equal(unit(null,modality!,cls,type,energy),'UNSPECIFIED');
 assert.equal(unit('MG/ML','CT',ct,'ORIGINAL\\PRIMARY\\AXIAL',null),'OTHER');
 assert.equal(unit('','CT',ct,'ORIGINAL\\PRIMARY\\AXIAL',null),'OTHER');
 assert.equal(unit('HU','CT',ct,'DERIVED\\PRIMARY\\AXIAL','YES'),'HU');
});
