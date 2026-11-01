import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");
const vision=readFileSync(new URL("../components/VisionFramePlanningPanel.tsx",import.meta.url),"utf8");

test("one primary clinical DICOM action starts local Vision before original detector forward",()=>{
 const start=source.indexOf("async function launch(){");
 const nativeStart=source.indexOf("const version=++serial.current;",start);
 const nativeVision=source.indexOf(
  'if(series.modality==="CT"||series.modality==="MR")onReadyForVision?.(series.key);',
  nativeStart);
 const firstHeavy=source.indexOf('if(plan.route==="monai-nodules")',nativeStart);
 assert.ok(start>0&&nativeStart>start&&nativeVision>nativeStart&&firstHeavy>nativeVision,
  "Local Vision preparation must not wait for CLN/nnU-Net CPU inference");
 const fallback=source.slice(start,nativeStart);
 assert.match(fallback,/if\(!ready\|\|\(!plan\.route&&!visionOnlyAvailable\)\)return;/);
 assert.match(fallback,/if\(!plan\.route\)\{[\s\S]*onReadyForVision\?\.\(series\.key\);[\s\S]*return;/,
  "Vision-only fallback must finish before any native model execution");
 assert.ok(!fallback.includes("OPUS_CLN_WORKER_TOKEN"));
 assert.match(vision,/autoStartAfterDetectors=\{fromPrimaryAnalysis\}/);
 assert.match(vision,/Кадры Vision подготавливаются независимо и локально/);
});
