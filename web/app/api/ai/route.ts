import { NextRequest, NextResponse } from "next/server";
import { callAiGateway, validateAiGatewayRequest } from "../../../lib/ai-gateway";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  // Do not allow untrusted public clients to consume provider credits.
  const configuredToken = process.env.RADIOLOGY_AI_GATEWAY_TOKEN;
  if (!configuredToken) return NextResponse.json({ error: "AI gateway disabled until authentication is configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${configuredToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 8_000_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!validateAiGatewayRequest(input)) return NextResponse.json({ error: "Invalid AI request" }, { status: 400 });
  try {
    const result = await callAiGateway(input, AbortSignal.timeout(120_000));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
