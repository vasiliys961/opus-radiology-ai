import {NextRequest, NextResponse} from "next/server";
import {callAiGateway} from "../../../../lib/ai-gateway";
import {
  executeSyntheticTrial, parseSyntheticTrialInput,
  sharedSyntheticTrialLimiter, SyntheticTrialFailure,
} from "../../../../lib/synthetic-live-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const MAX_BODY_BYTES = 700;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
/**
 * Browser-triggered, localhost+dev-only paid synthetic demonstration.
 * All PNGs originate from server-owned mathematical phantoms. The caller
 * cannot provide an image, clinical text, DICOM, patient ID or custom prompt.
 * The token never leaves Node. This route must never be deployed for clinical use.
 */
async function parseSmallJson(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_BODY_BYTES)
    throw new Error("too-large");
  if (!request.body) throw new Error("invalid");
  const reader = request.body.getReader();
  let received = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) throw new Error("too-large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {buffer.set(chunk, offset); offset += chunk.length;}
  try {return JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(buffer));}
  catch {throw new Error("invalid");}
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const url = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const site = request.headers.get("sec-fetch-site");
  if (process.env.NODE_ENV !== "development" ||
      !LOCAL_HOST.test(host) ||
      !["localhost","127.0.0.1"].includes(url.hostname)) {
    return NextResponse.json({error:"Synthetic trial only available on local Next development server"},
      {status:404, headers:HEADERS});
  }
  // Next.js may normalize nextUrl.origin to localhost while the browser uses
  // 127.0.0.1. Match the Origin to the actually received, allowlisted Host.
  if (origin !== "http://" + host || (site !== null && site !== "same-origin")) {
    return NextResponse.json({error:"Same-origin browser request required"},
      {status:403, headers:HEADERS});
  }
  if (url.search || !/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type") ?? "")) {
    return NextResponse.json({error:"Only JSON with no query parameters is accepted"},
      {status:415, headers:HEADERS});
  }
  let body: unknown;
  try {body = await parseSmallJson(request);}
  catch (error) {
    return NextResponse.json({error:"Invalid or oversized synthetic-only payload"},
      {status:error instanceof Error && error.message === "too-large" ? 413 : 400,headers:HEADERS});
  }
  const input = parseSyntheticTrialInput(body);
  if (!input) {
    return NextResponse.json({error:"Only synthetic modality, region, catalogue model IDs and explicit cost acceptance allowed"},
      {status:400, headers:HEADERS});
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    return NextResponse.json({error:"OpenRouter API key not configured in web/.env.local"},
      {status:503, headers:HEADERS});
  }
  const release = sharedSyntheticTrialLimiter.acquire();
  if (!release) {
    return NextResponse.json({error:"Synthetic experiments are limited to one at a time and four starts per 10 minutes"},
      {status:429,headers:{...HEADERS,"Retry-After":"120"}});
  }
  try {
    const result = await executeSyntheticTrial(input,process.env,fetch,
      callAiGateway,AbortSignal.timeout(240_000));
    return NextResponse.json(result,{headers:HEADERS});
  } catch (error) {
    // Provider raw responses, keys and stack traces must never reach a client.
    if (error instanceof SyntheticTrialFailure) {
      const problems: Record<SyntheticTrialFailure["code"],string> = {
        "no-key":"OpenRouter key not configured",
        "catalog-unavailable":"OpenRouter catalogue not reachable with current key",
        "unsupported-model":"Selected models are missing or do not declare required image/text modalities",
        "invalid-result":"Remote result failed the evidence provenance checks",
      };
      return NextResponse.json({error:problems[error.code]},
        {status:error.code === "unsupported-model" ? 422 : 502,headers:HEADERS});
    }
    // Diagnostic codes are safe; provider response bodies and credentials
    // are never surfaced to the browser or written into the HTTP error.
    const providerStatus = error instanceof Error ?
      /^AI provider returned HTTP ([0-9]{3})$/.exec(error.message)?.[1] : undefined;
    if (providerStatus) {
      const hints: Record<string,string> = {
        "400":"Model request incompatible with this OpenRouter provider",
        "401":"OpenRouter rejected the server API key",
        "402":"OpenRouter account lacks available credits",
        "403":"OpenRouter provider access blocked for this account or region",
        "404":"Selected model or endpoint not available to this account",
        "429":"OpenRouter rate limit or quota exceeded",
        "503":"OpenRouter endpoint temporarily unavailable",
      };
      return NextResponse.json({error:hints[providerStatus] ??
        "OpenRouter returned HTTP "+providerStatus},
        {status:502,headers:HEADERS});
    }
    return NextResponse.json({error:"Synthetic AI experiment failed: provider access, model JSON or quota may be incompatible"},
      {status:502,headers:HEADERS});
  } finally {
    release();
  }
}
