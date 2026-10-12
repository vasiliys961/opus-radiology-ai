import test from "node:test";
import assert from "node:assert/strict";
import { syntheticVisionFrames } from "./synthetic-vision-phantom.ts";
import {
  assertVisionInput, parseRoleResponse, parseCritic, parseClinicalDraft,
  readCompletionText, runVisionOrchestra, type CompletionCaller, type VisionInput,
} from "./vision-orchestra.ts";
import { validateEvidenceJson } from "./evidence-json.ts";

function input(): VisionInput {
  return {
    provider: "polza", modality: "CT",
    visionModel: "google/gemini-test-id", clinicalModel: "anthropic/claude-test-id",
    frames: syntheticVisionFrames("CT"),
  };
}
const response = (object: unknown) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(object) } }],
});
test("Synthetic test frames are actual bounded valid grayscale PNG images", () => {
  const frames = syntheticVisionFrames("MR");
  assert.equal(frames.length, 2);
  assert.doesNotThrow(() => assertVisionInput({ ...input(), modality: "MR", frames }));
  for (const f of frames) {
    const png = Buffer.from(f.base64, "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 96);
    assert.equal(png.readUInt32BE(20), 96);
    assert.ok(png.length < 100_000);
  }
});
test("Input refuses forged MIME types, duplicate IDs and oversized samples", () => {
  const valid = input();
  assert.doesNotThrow(() => assertVisionInput(valid));
  assert.throws(() => assertVisionInput({ ...valid, frames: [
    { ...valid.frames[0], mimeType: "image/jpeg" },
  ] }), /signature/);
  assert.throws(() => assertVisionInput({ ...valid, frames: [
    valid.frames[0], valid.frames[0],
  ] }), /Invalid frame/);
  assert.throws(() => assertVisionInput({ ...valid, frames: [] }), /1–4/);
});
test("Role contract refuses invented images and critic refuses invented findings", () => {
  assert.throws(() => parseRoleResponse({
    role: "observations", reviewedImageIds: ["missing"], observations: [], limitations: [],
  }, "observations", ["synthetic-thorax-0"]), /contract/);
  assert.throws(() => parseCritic({ needsRecheck: [], conflicts: ["not-seen"], limitations: [] },
    ["synthetic-thorax-0"], ["anatomy:visible"]), /unknown/);
  assert.throws(() => parseClinicalDraft({ summary: "", limitations: [] }), /contract/);
});
test("Completion parser rejects truncations, refusal, mixed text and tool responses", () => {
  assert.throws(() => readCompletionText({
    choices: [{ finish_reason: "length", message: { content: "{}" } }],
  }), /incomplete/);
  assert.throws(() => readCompletionText({ choices: [] }), /one completion/);
});
test("Gemini role calls, critic and GPT/Claude synthesis preserve provenance", async () => {
  const seen: Array<{ role: string; model: string; provider: string; content: unknown }> = [];
  const call: CompletionCaller = async request => {
    seen.push({ role: request.role, model: request.model, provider: request.provider,
      content: request.messages[1].content });
    if (request.role === "reasoning") return response({
      summary: "Synthetic geometry sample only. No diagnostic assessment.",
      limitations: ["Two frames, not a real study."],
    });
    const system = String(request.messages[0].content);
    if (system.includes("Independent evidence critic")) return response({
      needsRecheck: ["synthetic-thorax-0"],
      conflicts: ["anatomy:structure"], limitations: ["Nonmedical phantom"],
    });
    const role = system.includes('"role":"anatomy"') ? "anatomy" :
      system.includes('"role":"observations"') ? "observations" : "quality";
    return response({
      role, reviewedImageIds: ["synthetic-thorax-0", "synthetic-thorax-1"],
      observations: role === "anatomy" ? [{
        id: "structure", imageId: "synthetic-thorax-0", anatomy: "geometric schematic",
        sign: "two dark ellipses", uncertainty: "synthetic phantom",
      }] : [], limitations: ["Not a diagnostic image"],
    });
  };
  const result = await runVisionOrchestra(input(), call);
  assert.equal(seen.length, 5);
  assert.equal(seen.filter(r => r.role === "vision").length, 4);
  assert.equal(seen.filter(r => r.role === "reasoning").length, 1);
  assert.ok(seen.every(r => r.provider === "polza"));
  assert.equal(seen[0].model, "google/gemini-test-id");
  assert.equal(seen[3].model, "anthropic/claude-test-id"); // evaluator reviews the images independently of Vision
  assert.equal(seen[4].model, "anthropic/claude-test-id");
  assert.equal(result.evidence.coverage, "partially_assessed");
  assert.equal(result.evidence.findings[0].status, "requires_recheck");
  assert.equal(result.evidence.findings[0].measurements.diameterMm, null);
  assert.equal(result.clinicalStatus, "unverified_research_draft");
  assert.equal(validateEvidenceJson(result.evidence), true);
  assert.ok(result.sourceImages.every(f => !("base64" in f)));
  assert.ok(seen.filter(r => r.role === "vision").every(r =>
    Array.isArray(r.content) && r.content.some((p: { type?: string }) => p.type === "image_url")));
  assert.equal(typeof seen[4].content, "string");
});
test("No clinical model is called if a vision role invents an unknown frame", async () => {
  let clinicalCalls = 0;
  const call: CompletionCaller = async req => {
    if (req.role === "reasoning") {
      clinicalCalls++;
      return response({ summary: "Invalid", limitations: [] });
    }
    return response({
      role: "anatomy", reviewedImageIds: ["different-series"],
      observations: [], limitations: [],
    });
  };
  await assert.rejects(runVisionOrchestra(input(), call), /contract/);
  assert.equal(clinicalCalls, 0);
});
