import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { callAiGateway } from "../../../../lib/ai-gateway";
import { runVisionOrchestra } from "../../../../lib/vision-orchestra";
import { syntheticVisionFrames } from "../../../../lib/synthetic-vision-phantom";
import { isAiProvider } from "../../../../lib/ai-gateway";
import { HttpBodyTooLarge, readLimitedText } from "../../../../lib/limited-body";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Development-only cloud experiment.
 * NO patient input is accepted: image frames come only from hard-coded
 * non-medical PNG phantoms generated in this server process.
 */
const noStore = { "Cache-Control": "no-store" };
function authorized(received: string | null, expected: string): boolean {
  const a = Buffer.from(received ?? "");
  const b = Buffer.from("Bearer " + expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const shortText = (v: string | undefined): v is string => typeof v === "string" && v.length > 0 && v.length < 160;

export async function POST(request: NextRequest) {
  const token = process.env.RADIOLOGY_AI_GATEWAY_TOKEN;
  if (!token || process.env.RADIOLOGY_ENABLE_SYNTHETIC_AI !== "1") {
    return NextResponse.json({ error: "Synthetic research AI experiment is disabled" }, { status: 503, headers: noStore });
  }
  if (!authorized(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length < 0 || length > 2048) {
    return NextResponse.json({ error: "Invalid request length" }, { status: 413, headers: noStore });
  }
  let body: unknown;
  try { body = JSON.parse(await readLimitedText(request, 2048)); }
  catch (cause) {
    return NextResponse.json(
      { error: cause instanceof HttpBodyTooLarge ? "Request body too large" : "Invalid JSON" },
      { status: cause instanceof HttpBodyTooLarge ? 413 : 400, headers: noStore },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400, headers: noStore });
  }
  const data = body as Record<string, unknown>;
  // Reject images, clinical context, filenames and other caller content,
  // including unknown keys, to prevent accidental patient-data transfers.
  if (Object.keys(data).some(key => key !== "provider" && key !== "modality") ||
      !isAiProvider(data.provider) || (data.modality !== "CT" && data.modality !== "MR")) {
    return NextResponse.json({ error: "Only provider and modality are accepted" }, { status: 400, headers: noStore });
  }
  const p = data.provider === "polza" ? "POLZA" : "OPENROUTER";
  const vision = process.env["RADIOLOGY_" + p + "_VISION_MODEL"];
  const clinical = process.env["RADIOLOGY_" + p + "_CLINICAL_MODEL"];
  if (!shortText(vision) || !shortText(clinical)) {
    return NextResponse.json({ error: "Provider-specific vision and clinical model IDs are not configured" },
      { status: 503, headers: noStore });
  }
  try {
    const result = await runVisionOrchestra({
      provider: data.provider, modality: data.modality,
      visionModel: vision, clinicalModel: clinical,
      frames: syntheticVisionFrames(data.modality),
    }, callAiGateway, AbortSignal.timeout(240_000));
    return NextResponse.json(result, { headers: noStore });
  } catch {
    // No provider response fragments or secrets exposed through the HTTP API.
    return NextResponse.json(
      { error: "Research pipeline failed. Check server-side provider connectivity, model capability and JSON format." },
      { status: 502, headers: noStore },
    );
  }
}
