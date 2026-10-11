export type AiProvider = "openrouter" | "polza";
export type AiRole = "vision" | "reasoning";
export interface AiGatewayRequest {
  provider: AiProvider;
  role: AiRole;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }>;
  temperature?: number;
  maxTokens?: number;
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
  const config = PROVIDERS[request.provider];
  const apiKey = process.env[config.env];
  if (!apiKey) throw new Error(`Provider ${request.provider} is not configured`);
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // All research completions have an explicit output token ceiling to avoid
    // accidental unbounded spending. This is not an account spending limit.
    body: JSON.stringify({ model: request.model, messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: Number.isInteger(request.maxTokens) &&
        request.maxTokens! >= 1 && request.maxTokens! <= 1500 ? request.maxTokens : 1200 }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
  const payload = await response.json();
  return { provider: request.provider, model: payload.model ?? request.model, choices: payload.choices ?? [], usage: payload.usage ?? null };
}
