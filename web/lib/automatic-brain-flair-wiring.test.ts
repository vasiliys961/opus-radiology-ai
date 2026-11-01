import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");

test("automatic FLAIR metadata enters the real WMH route; unknown MRI enters Vision before any model",()=>{
 assert.match(source,/const autoFlair=useMemo\(\(\)=>assessAutomaticBrainFlair\(series\)/);
 assert.match(source,/\(flairConfirmed\|\|autoFlair\.eligible\)&&sourceUrl\.startsWith\("https:\/\/"\)/);
 assert.match(source,/const brainVisionOnly=plan\.route==="wmh-flair"&&brainTask==="wmh"&&/);
 assert.match(source,/\(!autoWmhReady&&!token\.trim\(\)\)/,
   "An unavailable original WMH worker must not block independent Vision");
 const fallback=source.indexOf('if(brainVisionOnly){');
 const actualModel=source.indexOf('const version=++serial.current;',fallback);
 assert.ok(fallback>0&&actualModel>fallback,"Vision-only fallback must precede heavy WMH inference");
 const path=source.slice(fallback,actualModel);
 assert.match(path,/onDetectorEvidence\?\.\(series\.key,null\)/);
 assert.match(path,/onReadyForVision\?\.\(series\.key\)/);
 assert.match(path,/return;/);
 assert.ok(!path.includes("invokeWmh"),"Never submit uncertain MRI weighting to original WMH worker");
});
test("automatic FLAIR does not bypass explicit source rights or cloud approval",()=>{
 assert.match(source,/\(flairConfirmed\|\|autoFlair\.eligible\)&&sourceUrl\.startsWith\("https:\/\/"\)&&!!sourceLicense\.trim\(\)/);
 assert.match(source,/const ready=\(!!plan\.route\|\|visionOnlyAvailable\)&&authorized/);
 assert.match(source,/form\.set\("publicRights","yes"\)/);
 assert.ok(!source.includes('setAuthorized(true)'),"No automatic patient/research consent");
});
