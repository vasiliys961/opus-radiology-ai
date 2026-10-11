import { NextRequest, NextResponse } from "next/server";
import { inspectProvider } from "../../../../lib/provider-readiness";
import { isAiProvider } from "../../../../lib/ai-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

/**
 * Explicit read-only diagnostics, available only on localhost in next dev.
 * Never receives DICOM files, patient text, tokens, raw model messages or pixels.
 * Credentials are read only from server environment and never returned.
 *
 * This does NOT unlock /api/ai/orchestrate, real clinical requests or uploads.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development" ||
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(request.nextUrl.hostname)) {
    return NextResponse.json({ error: "Only available in local development" },
      { status: 404, headers: HEADERS });
  }
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") {
    return NextResponse.json({ error: "Cross-site requests are not accepted" },
      { status: 403, headers: HEADERS });
  }
  const keys = [...request.nextUrl.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "provider") {
    return NextResponse.json({ error: "Only provider may be specified" },
      { status: 400, headers: HEADERS });
  }
  const provider = request.nextUrl.searchParams.get("provider");
  if (!isAiProvider(provider)) {
    return NextResponse.json({ error: "Unsupported provider" },
      { status: 400, headers: HEADERS });
  }
  try {
    const result = await inspectProvider(provider, process.env);
    return NextResponse.json(result, { headers: HEADERS });
  } catch {
    // Keep private credentials and upstream errors out of client/server logs.
    return NextResponse.json({ error: "Read-only provider check failed" },
      { status: 503, headers: HEADERS });
  }
}
