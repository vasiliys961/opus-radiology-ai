import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const component=readFileSync(new URL("../components/VisionFramePlanningPanel.tsx",import.meta.url),"utf8");

test("strict-mode effect replay cannot consume a one-shot auto-plan ref",()=>{
 assert.doesNotMatch(component,/autoPreparedSeriesKey/,"One-shot refs must not suppress replayed preview effects");
 const reset=component.split("useEffect(() => {")[1]?.split("useEffect(() => {")[0];
 assert.ok(reset,"reset effect missing");
 assert.match(reset,/setReport\(activeSeriesKey&&universal\.status==="eligible_for_authorization"&&\s*choice\.status==="ready-for-local-preview"\?choice:null\)/);
 assert.match(reset,/setThumbnails\(\{\}\)/);
 assert.match(reset,/\[series, activeSeriesKey, requested, universal, choice\]/);
});
