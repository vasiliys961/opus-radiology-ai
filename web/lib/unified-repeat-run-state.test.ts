import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// A previous completed detector must never persist into a new attempt on the same series.
const source=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");
test("new primary DICOM analysis invalidates every prior lung pathology result",()=>{
  const launch=source.split("async function launch(){")[1]?.split("const session:WorkerSession")[0];
  assert.ok(launch,"primary launch must exist");
  for(const setter of ["setChestSource","setChestNodules","setChestCln","setLungscapeResult",
    "setChestEffusion","setChestPe","setChestNodes","setChestIssues"]){
    assert.match(launch,new RegExp(setter+"\\("+ (setter==="setChestIssues"?"\\[\\]":"null")+"\\)"),
      setter+" stale detector evidence must not survive a rerun");
  }
  assert.match(launch,/onDetectorEvidence\?\.\(series\.key,null\)/,
    "previous consilium evidence must be cleared before reanalysis");
});
