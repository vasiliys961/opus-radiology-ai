/**
 * Read-only, server-side provider diagnostics for the research AI gateway.
 *
 * Security invariants:
 * - No patient data, prompt, image, filename or clinical context accepted.
 * - API tokens never leave the server; only boolean configuration status does.
 * - The only remote catalogue URL is a constant OpenRouter endpoint.
 * - A fetched model ID is a catalogue claim, NOT proof of access, reliability,
 *   billing permission, residency compliance or diagnostic suitability.
 */
import type { AiProvider } from "./ai-gateway";

export type CatalogModel = {
  id: string;
  name: string;
  acceptsImages: boolean;
  acceptsText: boolean;
  producesText: boolean;
};
export type RoleCheck = {
  modelId: string | null;
  configured: boolean;
  inCatalogue: boolean | null;
  matchingModality: boolean | null;
};
export type ProviderReadinessReport = {
  schema: "opus-provider-readiness/v1";
  provider: AiProvider;
  keyConfigured: boolean;
  catalogStatus: "verified-response" | "disabled" | "unavailable" | "not-supported";
  vision: RoleCheck;
  clinical: RoleCheck;
  suggestions: { vision: CatalogModel[]; clinical: CatalogModel[] };
  notes: string[];
  patientImagesAllowed: false;
  inferenceAllowed: false;
};
export type ProviderEnv = Readonly<Record<string, string | undefined>>;
export type CatalogFetcher = typeof fetch;

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CATALOG_MAX_BYTES = 8_000_000;
const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/:._+-]{0,159}$/;
const PROVIDER_ENV = {
  openrouter: {
    key: "OPENROUTER_API_KEY",
    vision: "RADIOLOGY_OPENROUTER_VISION_MODEL",
    clinical: "RADIOLOGY_OPENROUTER_CLINICAL_MODEL",
  },
  polza: {
    key: "POLZA_API_KEY",
    vision: "RADIOLOGY_POLZA_VISION_MODEL",
    clinical: "RADIOLOGY_POLZA_CLINICAL_MODEL",
  },
} as const;
const TEXT_NOTE =
  "Каталог отражает заявленные возможности моделей, не гарантирует доступность через аккаунт, " +
  "регион, тариф или качество анализа медицинских изображений.";

function modelId(envValue: string | undefined): string | null {
  const value = envValue?.trim() ?? "";
  return MODEL_ID_PATTERN.test(value) ? value : null;
}
function emptyRole(model: string | null): RoleCheck {
  return { modelId: model, configured: model !== null, inCatalogue: null, matchingModality: null };
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function modalities(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}
export function parseOpenRouterModels(data: unknown): CatalogModel[] {
  if (!object(data) || !Array.isArray(data.data) || data.data.length > 10_000)
    throw new Error("Invalid model catalogue format");
  const result: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const item of data.data) {
    if (!object(item) || typeof item.id !== "string" || !MODEL_ID_PATTERN.test(item.id) ||
        !object(item.architecture) || seen.has(item.id)) continue;
    const inputs = modalities(item.architecture.input_modalities);
    const outputs = modalities(item.architecture.output_modalities);
    // Some provider responses give only architecture.modality; do NOT infer
    // image support from model names or a missing explicit modalities array.
    const entry: CatalogModel = {
      id: item.id,
      name: typeof item.name === "string" && item.name.length <= 120 ? item.name : item.id,
      acceptsImages: inputs.includes("image"),
      acceptsText: inputs.includes("text"),
      producesText: outputs.includes("text"),
    };
    result.push(entry);
    seen.add(entry.id);
  }
  if (result.length === 0) throw new Error("No valid models in catalogue");
  return result;
}
export function compareConfiguredRoles(
  visionId: string | null, clinicalId: string | null,
  catalogue: readonly CatalogModel[],
): {vision: RoleCheck; clinical: RoleCheck} {
  const byId = new Map(catalogue.map(x => [x.id, x]));
  const role = (id: string | null, mode: "vision" | "clinical"): RoleCheck => {
    if (!id) return emptyRole(null);
    const model = byId.get(id);
    return {
      modelId: id, configured: true, inCatalogue: !!model,
      matchingModality: model ? mode === "vision" ?
        model.acceptsImages && model.producesText :
        model.acceptsText && model.producesText : false,
    };
  };
  return {vision: role(visionId, "vision"), clinical: role(clinicalId, "clinical")};
}
/** Bounded read prevents a malfunctioning remote response exhausting 8 GB Macs. */
export async function readBoundedJson(response: Response): Promise<unknown> {
  const announced = Number(response.headers.get("content-length") ?? 0);
  if (announced > CATALOG_MAX_BYTES) throw new Error("Catalogue response too large");
  if (!response.body) throw new Error("Empty catalogue response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > CATALOG_MAX_BYTES) throw new Error("Catalogue response too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
}
/** Only a researcher-initiated metadata request is made; nothing clinical is sent. */
export async function inspectProvider(
  provider: AiProvider,
  env: ProviderEnv,
  fetcher: CatalogFetcher = fetch,
): Promise<ProviderReadinessReport> {
  const names = PROVIDER_ENV[provider];
  const configuredKey = !!env[names.key]?.trim();
  const visionId = modelId(env[names.vision]);
  const clinicalId = modelId(env[names.clinical]);
  const base: ProviderReadinessReport = {
    schema: "opus-provider-readiness/v1", provider,
    keyConfigured: configuredKey, catalogStatus: "disabled",
    vision: emptyRole(visionId), clinical: emptyRole(clinicalId),
    suggestions: { vision: [], clinical: [] },
    notes: [TEXT_NOTE],
    patientImagesAllowed: false,
    inferenceAllowed: false,
  };
  if (!configuredKey) {
    base.notes.unshift("Ключ этого провайдера на сервере не настроен.");
    return base;
  }
  if (provider === "polza") {
    base.catalogStatus = "not-supported";
    base.notes.unshift("Каталог моделей Polza пока не проверяется: нужен подтверждённый endpoint и контракт.");
    return base;
  }
  let catalogue: CatalogModel[];
  try {
    const response = await fetcher(CATALOG_URL, {
      method: "GET", cache: "no-store",
      headers: {
        Authorization: "Bearer " + env[names.key]!.trim(),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Provider catalogue HTTP error");
    catalogue = parseOpenRouterModels(await readBoundedJson(response));
  } catch {
    // Never return the remote response body or the API key to the browser.
    base.catalogStatus = "unavailable";
    base.notes.unshift("Не удалось проверить каталог OpenRouter; проверьте сеть, ключ и ограничения аккаунта.");
    return base;
  }
  const matches = compareConfiguredRoles(visionId, clinicalId, catalogue);
  const summary = (values: CatalogModel[]) => values
    .sort((a, b) => {
      // Make candidate examples familiar but don't claim a model is clinically approved.
      const priority = (s: string) =>
        /^(google|openai|anthropic)\//.test(s) ? 0 : 1;
      return priority(a.id) - priority(b.id) || a.id.localeCompare(b.id);
    }).slice(0, 14);
  return {
    ...base, catalogStatus: "verified-response",
    vision: matches.vision, clinical: matches.clinical,
    suggestions: {
      vision: summary(catalogue.filter(x => x.acceptsImages && x.producesText)),
      clinical: summary(catalogue.filter(x => x.acceptsText && x.producesText)),
    },
    notes: [
      "Проверен ответ каталога OpenRouter без отправки DICOM или клинического текста.",
      TEXT_NOTE,
      "Серверные идентификаторы моделей задаются через RADIOLOGY_OPENROUTER_VISION_MODEL " +
      "и RADIOLOGY_OPENROUTER_CLINICAL_MODEL в web/.env.local. Выбор в браузере пока только предпочтение.",
    ],
  };
}
