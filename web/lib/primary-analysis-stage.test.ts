import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {canSubmitCombinedVisionReview} from "./primary-analysis-stage.ts";

const primary=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");
const viewer=readFileSync(new URL("../app/viewer/page.tsx",import.meta.url),"utf8");
const vision=readFileSync(new URL("../components/VisionFramePlanningPanel.tsx",import.meta.url),"utf8");
const privacy=readFileSync(new URL("../components/VisionPrivacyPreparation.tsx",import.meta.url),"utf8");
const cloud=readFileSync(new URL("../components/DeidentifiedOpenRouterPanel.tsx",import.meta.url),"utf8");

test("a pending or cancelled native detector cannot be skipped for a final combined AI report",()=>{
 assert.equal(canSubmitCombinedVisionReview("running"),false);
 assert.equal(canSubmitCombinedVisionReview("cancelled"),false);
 assert.equal(canSubmitCombinedVisionReview("completed"),true);
 assert.equal(canSubmitCombinedVisionReview("vision-only"),true);
 assert.equal(canSubmitCombinedVisionReview("idle"),true);
});
test("single physician Analyze action propagates the original detector state to the pixel and provider gates",()=>{
 assert.match(primary,/onAnalysisStage\?\.\(series\.key,"running"\)/);
 assert.match(primary,/onAnalysisStage\?\.\(series\.key,"completed"\)/);
 assert.match(primary,/onAnalysisStage\?\.\(series\.key,"vision-only"\)/);
 assert.match(primary,/onAnalysisStage\?\.\(series\.key,"cancelled"\)/);
 assert.match(viewer,/onAnalysisStage=\{\(key,stage\)=>/);
 assert.match(viewer,/primaryAnalysisStage=\{visionFromPrimary&&primaryStage/);
 assert.match(vision,/primaryAnalysisStage=\{primaryAnalysisStage\}/);
 assert.match(privacy,/primaryAnalysisStage=\{primaryAnalysisStage\}/);
 assert.match(cloud,/canSubmitCombinedVisionReview\(primaryAnalysisStage\)/);
});
test("paid Gemini and Opus calls remain a direct clinician action after source-bound privacy checks",()=>{
 assert.match(cloud,/!enabledByLocalChecks\|\|!modelPathSettled\|\|token\.length<24\|\|!transferAuthorized/);
 assert.match(cloud,/disabled=\{working\|\|lateWorking\|\|!enabledByLocalChecks\|\|!modelPathSettled/);
 assert.match(cloud,/onClick=\{\(\)=>void send\(\)\}/);
 assert.match(cloud,/if\(controller\.signal\.aborted\)return;/);
 assert.match(cloud,/ctl\.current\?\.abort\(\);setTransferAuthorized\(false\);setResult\(null\)/);
 assert.match(cloud,/acknowledgeTwoPaidCalls:true/);
 assert.match(cloud,/downloadRadiologistText/);
});
