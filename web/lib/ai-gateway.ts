export type AiProvider = "openrouter" | "polza";
export type AiRole = "vision" | "reasoning";
/** Internal-only OpenRouter structured output; never constructed from browser input. */
export type AiJsonSchemaFormat={
  type:"json_schema";
  json_schema:{name:string;strict:true;schema:Record<string,unknown>};
};
export interface AiGatewayRequest {
  provider: AiProvider;
  role: AiRole;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?:AiJsonSchemaFormat;
  /** Refuse OpenRouter endpoints that silently ignore the JSON schema. */
  requireParameters?:true;
}
const PROVIDERS: Record<AiProvider, { url: string; env: string }> = {
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", env: "OPENROUTER_API_KEY" },
  polza: { url: "https://polza.ai/api/v1/chat/completions", env: "POLZA_API_KEY" },
};
export function isAiProvider(value: unknown): value is AiProvider {
  return value === "openrouter" || value === "polza";
}
export function validateAiGatewayRequest(value: unknown): value is AiGatewayRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isAiProvider(v.provider) && (v.role === "vision" || v.role === "reasoning") &&
    typeof v.model === "string" && v.model.length > 0 && v.model.length <= 160 &&
    Array.isArray(v.messages) && v.messages.length > 0 && v.messages.length <= 30 &&
    v.messages.every((m: unknown) => !!m && typeof m === "object" &&
      ["system", "user", "assistant"].includes((m as {role?: string}).role ?? "") &&
      (typeof (m as {content?: unknown}).content === "string" || Array.isArray((m as {content?: unknown}).content)));
}
export async function callAiGateway(request: AiGatewayRequest, signal?: AbortSignal) {
  if(request.responseFormat&&(request.provider!=="openrouter"||request.requireParameters!==true))
    throw Error("Structured output requires a compatible OpenRouter endpoint");
  const config = PROVIDERS[request.provider];
  const apiKey = process.env[config.env];
  if (!apiKey) throw new Error(`Provider ${request.provider} is not configured`);
  // A source-checked Opus report needs room for standard CT/MRI organ sections,
  // structured comparisons and limitations. Grant the higher budget ONLY to
  // this fixed, server-constructed Opus schema with strict provider enforcement.
  // All other structured research models remain capped at 2000 tokens.
  const professionalRadiologyReport=request.provider==="openrouter"&&
    request.model==="anthropic/claude-opus-5.5"&&
    request.requireParameters===true&&
    request.responseFormat?.json_schema.name==="opus_gemini_detector_report";
  const tokenCeiling=professionalRadiologyReport?4500:
    request.responseFormat?2000:1500;
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // All research completions have an explicit output token ceiling to avoid
    // accidental unbounded spending. This is not an account spending limit.
    body: JSON.stringify({ model: request.model, messages: request.messages,
      // These evaluator versions do not advertise temperature in either catalogue.
      ...(["openai/gpt-6.1-sol","anthropic/claude-sonnet-5.5","anthropic/claude-opus-5.5"].includes(request.model)?{}:
        {temperature:request.temperature??0.1}),
      ...(request.responseFormat?{response_format:request.responseFormat}:{}),
      ...(request.requireParameters?{provider:{require_parameters:true}}:{}),
      max_tokens: Number.isInteger(request.maxTokens) &&
        request.maxTokens! >= 1 && request.maxTokens! <= tokenCeiling ? request.maxTokens : 1200 }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
  const payload = await response.json();
  return { provider: request.provider, model: payload.model ?? request.model, choices: payload.choices ?? [], usage: payload.usage ?? null };
}
