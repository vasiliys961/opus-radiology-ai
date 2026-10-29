import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../components/UnifiedDicomStudyAnalysis.tsx",import.meta.url),"utf8");
test("one-click chest runs verified automatic original models without browser worker credentials",()=>{
 for(const [name,pattern] of [
  ["MONAI",/if\(autoMonaiReady\|\|token\.trim\(\)\)[\s\S]*?executeRealNodule\(autoMonaiReady\?null:session,nifti/],
  ["PE",/if\(autoPeReady\|\|peToken\.trim\(\)\)[\s\S]*?executeOriginalPeCtp\(\s*autoPeReady\?null:/],
  ["Raidionics",/if\(autoNodesReady\|\|nodeToken\.trim\(\)\)[\s\S]*?runOriginalRaidionicsNodes\(\s*autoNodesReady\?null:/],
 ] as const)assert.match(source,pattern,name+" automatic dispatch must not silently require token");
 assert.match(source,/if\(ctpaConfirmed\)\{/);
 assert.match(source,/if\(enhancedChestConfirmed\)\{/);
});
