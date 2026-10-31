import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");
const vision=readFileSync(new URL("../components/VisionFramePlanningPanel.tsx",import.meta.url),"utf8");
test("one primary clinical DICOM action starts local Vision BEFORE heavy original detector forward",()=>{
 const start=source.indexOf("async function launch(){");
 const callback=source.indexOf('onReadyForVision?.(series.key);',start);
 const firstHeavy=source.indexOf('if(plan.route==="monai-nodules")',start);
 assert.ok(start>0&&callback>start&&firstHeavy>callback,
  "Vision local preparation must not wait for long CLN/nnU-Net CPU inference");
 const pre=source.slice(start,callback);
 assert.match(pre,/if\(!ready\|\|!plan\.route\)return;/);
 assert.match(pre,/if\(series\.modality==="CT"\|\|series\.modality==="MR"\)/);
 assert.ok(!pre.includes("OPUS_CLN_WORKER_TOKEN"));
 assert.match(vision,/autoStartAfterDetectors=\{fromPrimaryAnalysis\}/);
 assert.match(vision,/Кадры Vision подготавливаются независимо и локально/);
});
