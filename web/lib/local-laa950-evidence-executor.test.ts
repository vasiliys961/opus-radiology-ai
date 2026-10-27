import {strict as assert} from "node:assert";
import {localLaa950Executor,LAA950_TARGET} from "./local-laa950-evidence-executor.ts";
import {routeDicomConsilium} from "./dicom-consilium-routing.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
const metadata={modality:"CT",bodyRegion:"CHEST",imageRole:"PRIMARY",
  seriesUid:"1.2.3",sopInstanceUid:"1.2.3.4"} as TechnicalDicomMetadata;
const series:DicomSeries={key:"s",label:"CT",modality:"CT",
  members:[{id:"a",name:"a",metadata}],spatiallySorted:true,volumeReady:true,
  sliceSpacingMm:1,warning:null};
const target=routeDicomConsilium(series);
assert.equal(target.status,"ready");
if(target.status!=="ready")throw Error("Unexpected blocked CT");
assert.ok(target.detectorTargets.includes(LAA950_TARGET));
const mr=routeDicomConsilium({...series,modality:"MR",
  members:[{...series.members[0],metadata:{...metadata,modality:"MR"}}]});
assert.ok(mr.status==="blocked" || !mr.detectorTargets.includes(LAA950_TARGET));
const executor=localLaa950Executor(null,null);
assert.equal(executor.target,LAA950_TARGET);
assert.equal(executor.eligible(series),false);
await assert.rejects(()=>executor.run(series));
console.log("PASS local LAA950 requires matching original CT and R231 evidence");
