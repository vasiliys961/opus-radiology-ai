import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");
test("unified Analyze button admits verified automatic original brain workers without manual tokens",()=>{
 assert.match(source,/plan\.route==="ianpan-ich"\?true/);
 assert.match(source,/if\(!autoIchReady&&!token\.trim\(\)\)/);
 assert.match(source,/onReadyForVision\?\.\(series\.key\)/);
 assert.match(source,/plan\.route==="wmh-flair"\?\(\(brainTask==="wmh"\?autoWmhReady:autoBrainReady\)\|\|\s*\(!!token&&!!endpoint\.trim\(\)\)\)/);
 assert.match(source,/runPublicIchWorker\(autoIchReady\?null:session/);
 assert.match(source,/executeOriginalBrain\(autoBrainReady\?null:session/);
 assert.match(source,/const wmhSession=autoWmhReady\?null:session/);
 assert.match(source,/brainSequenceApproved&&brainAssignedReady&&sourceUrl\.startsWith\("https:\/\/"\)/);
 assert.match(source,/flairConfirmed&&sourceUrl\.startsWith\("https:\/\/"\)/);
});
