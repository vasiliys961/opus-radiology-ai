import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired unsafe generic gateway.
 *
 * The previous endpoint accepted arbitrary caller text/image messages whenever
 * a shared development bearer token was configured. A browser's knowledge of
 * a token is NOT physician authorization, consent or verified de-identification.
 *
 * No arbitrary patient content may reach a provider through this route.
 * The bounded synthetic-only test lives in /api/ai/orchestrate and creates
 * its own nonmedical PNGs server-side.
 */
export async function POST() {
  return NextResponse.json({
    error: "Unrestricted AI upload is disabled. No real patient images or clinical text may be transmitted.",
    required: [
      "authenticated clinician session",
      "per-study consent and data-processing authority",
      "DICOM tag and image-pixel de-identification verification",
      "approved provider, jurisdiction and audit trail",
    ],
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
