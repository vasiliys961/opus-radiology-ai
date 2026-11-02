import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");
test("unified Analyze button admits verified automatic original brain workers without manual tokens",()=>{
 assert.match(source,/const ready=\(!!plan\.route\|\|visionOnlyAvailable\|\|visionReady\)&&!busy&&!readinessChecksPending/);
 assert.match(source,/if\(!autoIchReady&&!token\.trim\(\)\)/);
 assert.match(source,/onReadyForVision\?\.\(series\.key\)/);
 assert.match(source,/if\(plan\.route==="wmh-flair"&&!sourceUrl\.trim\(\)\)/);
 assert.match(source,/if\(!autoBrainReady&&!token\.trim\(\)\)/);
 assert.match(source,/if\(!autoWmhReady&&!token\.trim\(\)\)/);
 assert.match(source,/runPublicIchWorker\(autoIchReady\?null:session/);
 assert.match(source,/executeOriginalBrain\(autoBrainReady\?null:session/);
 assert.match(source,/const wmhSession=autoWmhReady\?null:session/);


 assert.match(source,/const brainVisionOnly=plan\.route==="wmh-flair"&&brainTask==="wmh"&&/);
});
