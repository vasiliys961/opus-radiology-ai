/**
 * Development-only real HTTP smoke check of the read-only provider diagnostics.
 * No personal files, network provider requests or real credentials are used.
 */
import {spawn} from "node:child_process";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const project = fileURLToPath(new URL("../web/", import.meta.url));
const port = 3134;
const host = "http://127.0.0.1:" + port;
const secret = "synthetic-test-secret-not-for-patients";
const server = spawn(process.execPath, [
  "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1",
  "--port", String(port),
],{
  cwd: project,
  env: {
    ...process.env,
    NODE_ENV: "development",
    OPENROUTER_API_KEY: "",
    POLZA_API_KEY: "",
    RADIOLOGY_POLZA_VISION_MODEL: "synthetic/test-vision",
    RADIOLOGY_POLZA_CLINICAL_MODEL: "synthetic/test-reasoning",
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore","pipe","pipe"],
});
let stderr="";
server.stderr.on("data", chunk => stderr += String(chunk).slice(0,2500));
let killed=false;
const stop = async () => {
  if (killed) return;
  killed=true;
  server.kill("SIGTERM");
};
try {
  let ready = false;
  for(let i=0;i<90;i++) {
    if(server.exitCode !== null) throw new Error("Dev server crashed");
    try {
      const resp=await fetch(host + "/api/ai/provider-readiness?provider=polza",{
        signal:AbortSignal.timeout(3500),
      });
      if(resp.status===200) {ready=true;break;}
    } catch {/* booting */}
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  if(!ready) throw new Error("Dev provider API did not respond");
  const check = async (pathname, options) => {
    const resp = await fetch(host + pathname, { ...options, signal: AbortSignal.timeout(8000)});
    return {status:resp.status,body:await resp.text()};
  };
  const polza = await check("/api/ai/provider-readiness?provider=polza");
  assert.equal(polza.status,200);
  assert.equal(polza.body.includes(secret),false);
  const data=JSON.parse(polza.body);
  assert.equal(data.schema,"opus-provider-readiness/v1");
  assert.equal(data.keyConfigured,false);
  assert.equal(data.catalogStatus,"disabled");
  assert.equal(data.inferenceAllowed,false);
  assert.equal(data.patientImagesAllowed,false);
  assert.equal(data.vision.modelId,"synthetic/test-vision");
  const missing = await check("/api/ai/provider-readiness?provider=openrouter");
  assert.equal(missing.status,200);
  assert.equal(JSON.parse(missing.body).keyConfigured,false);
  assert.equal(JSON.parse(missing.body).catalogStatus,"disabled");
  assert.equal((await check("/api/ai/provider-readiness?provider=untrusted")).status,400);
  assert.equal((await check("/api/ai/provider-readiness?provider=polza&pixels=evil")).status,400);
  assert.equal((await check("/api/ai/provider-readiness?provider=polza",{
    headers:{"sec-fetch-site":"cross-site"},
  })).status,403);
  assert.equal((await check("/api/ai/provider-readiness?provider=polza",{
    method:"POST",
  })).status,405);
  // The exact non-patient PNG frames are served from local deterministic code.
  const preview=await fetch(host+"/api/ai/synthetic-demo/preview?region=abdomen&modality=CT&frame=0",{
    signal:AbortSignal.timeout(8000),
  });
  assert.equal(preview.status,200);
  assert.match(preview.headers.get("content-type")??"",/image\/png/);
  const png=Buffer.from(await preview.arrayBuffer());
  assert.equal(png.subarray(1,4).toString(),"PNG");
  assert.equal(png.readUInt32BE(16),96);
  assert.equal(png.readUInt32BE(20),96);
  assert.equal((await check("/api/ai/synthetic-demo/preview?region=patient&modality=CT&frame=0")).status,400);
  assert.equal((await check("/api/ai/synthetic-demo/preview?region=head&modality=CT&frame=0&file=anything")).status,400);
  // The new PAID OpenRouter synthetic research demo requires browser origin,
  // explicit consent and server key. These tests never contact any AI provider.
  const fakeTrial = {
    modality:"CT",region:"chest",visionModel:"google/gemini-3.8-flash",
    clinicalModel:"anthropic/claude-sonnet-5.5",acknowledgePaidSyntheticExperiment:true,
  };
  const trialHeaders = {
    "content-type":"application/json","origin":host,"sec-fetch-site":"same-origin",
  };
  assert.equal((await check("/api/ai/synthetic-demo",{
    method:"POST",headers:trialHeaders,body:JSON.stringify(fakeTrial),
  })).status,503);
  assert.equal((await check("/api/ai/synthetic-demo",{
    method:"POST",headers:{...trialHeaders,origin:"https://attacker.invalid"},
    body:JSON.stringify(fakeTrial),
  })).status,403);
  assert.equal((await check("/api/ai/synthetic-demo",{
    method:"POST",headers:trialHeaders,
    body:JSON.stringify({...fakeTrial,patientText:"diagnostic medical record"}),
  })).status,400);
  assert.equal((await check("/api/ai/synthetic-demo",{
    method:"POST",headers:trialHeaders,
    body:JSON.stringify({...fakeTrial,acknowledgePaidSyntheticExperiment:false}),
  })).status,400);
  assert.equal((await check("/api/ai/synthetic-demo",{
    method:"POST",headers:trialHeaders,
    body:JSON.stringify({...fakeTrial,base64:"x".repeat(3000)}),
  })).status,413);
  assert.equal((await check("/api/ai/synthetic-demo",{
    method:"GET",
  })).status,405);
  console.log("Synthetic paid demo: key gate, CSRF, exact schema and request-size limits verified.");
  const legacy = await check("/api/ai",{
    method:"POST", headers:{"content-type":"application/json"},
    body: JSON.stringify({provider:"openrouter",model:"test",messages:[]}),
  });
  assert.equal(legacy.status,410);
  assert.equal(legacy.body.includes(secret),false);
  console.log("PASS: localhost provider diagnostic, no key disclosure, both providers without keys disabled,");
  console.log("  OpenRouter without key disabled, invalid query/CSRF rejected, arbitrary uploads HTTP 410.");
} catch(e) {
  console.error("FAIL: provider diagnostic dev smoke check:", e);
  // Never print raw HTTP server output: it could contain configuration details.
  if(stderr.length) console.error("Server startup reported an error (logs hidden for secret safety).");
  process.exitCode=1;
} finally {
  await stop();
}
