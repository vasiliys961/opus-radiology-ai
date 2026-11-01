import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");

test("one-click analysis waits for model discovery before fallback",()=>{
  const gate=source.split("const readinessChecksPending=")[1]?.split("const ready=")[0];
  assert.ok(gate,"route-specific worker probe gate must exist");
  for(const name of ["clnChecking","lungscapeChecking","autoMonaiChecking","autoEffusionChecking",
    "autoPeChecking","autoNodesChecking","autoAbdomenChecking","autoIchChecking",
    "autoBrainChecking","autoWmhChecking"])assert.ok(gate.includes(name),name+" absent");
  assert.match(source,/const ready=\(!!plan\.route\|\|visionOnlyAvailable\)&&authorized&&!busy&&!readinessChecksPending&&/);
  assert.match(source,/plan\.route===null&&canUseVisionOnlyAsPrimary\(series,available\)/,
    "Universal Vision must be fallback-only, never bypass a compatible native model");
  for(const name of ["setClnChecking","setLungscapeChecking","setAutoBrainChecking",
    "setAutoWmhChecking"]){
    assert.match(source,new RegExp(name+"\\(true\\)"),name+" start missing");
    assert.match(source,new RegExp(name+"\\(false\\)"),name+" completion missing");
  }
});

test("probe waits end after bounded timeout even if an endpoint hangs",()=>{
  const signals=source.match(/AbortSignal\.any\(\[controller\.signal,AbortSignal\.timeout\(12_000\)\]\)/g)??[];
  assert.equal(signals.length,6,"all route probe groups must have a bounded deadline");
});
