/** Local research review journal. No authenticated identity, trusted clock,
 * signature, tamper-proof audit, review comments/identity fields, images or automatic persistence. */
import { reviewSegmentationEvidence, type EvidenceDecision, type SegmentationEvidence } from "./segmentation-evidence.ts";

export const MAX_REVIEW_EVENTS = 512;
export const MAX_REVIEW_JSON_BYTES = 256_000;
export type ReviewEvent = {
  revision: number;
  observationId: string;
  from: EvidenceDecision;
  to: EvidenceDecision;
  at: string;
  actor: "local-unverified-reviewer";
};
export type EvidenceReviewHistory = {
  schema: "opus-evidence-review/v1";
  provenance: "local-unverified";
  binding: { requestId: string; sourceIdentitySha256: string; inputSha256: string; maskSha256: string; weightsSha256: string; modelId: string; modelVersion: string };
  events: ReviewEvent[];
};
export type ReviewedEvidence = SegmentationEvidence & {reviewHistory: EvidenceReviewHistory};
const allowed = (x: unknown): x is EvidenceDecision => x === "unreviewed" || x === "requires_recheck" || x === "rejected";
const binding = (e: SegmentationEvidence): EvidenceReviewHistory["binding"] => ({requestId: e.source.requestId,
  sourceIdentitySha256: e.source.sourceIdentitySha256, inputSha256: e.source.inputSha256,
  maskSha256: e.mask.sha256, weightsSha256: e.producer.model.weightsSha256,
  modelId: e.producer.model.id, modelVersion: e.producer.model.version});
const validTime = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;

export function startEvidenceReview(evidence: SegmentationEvidence): ReviewedEvidence {
  if (evidence.observations.some(o => o.review !== "unreviewed"))
    throw new Error("История начинается с исходных непроверенных меток.");
  return {...evidence, reviewHistory: {schema: "opus-evidence-review/v1", provenance: "local-unverified", binding: binding(evidence), events: []}};
}

/** Time is supplied outside React's state updater so a replayed updater is pure.
 * Repeating a decision is a no-op; undo is a new transition, not event deletion. */
export function changeEvidenceReview(evidence: ReviewedEvidence, id: string, to: EvidenceDecision, at: string): ReviewedEvidence {
  const observation = evidence.observations.find(o => o.observationId === id);
  if (!observation || !allowed(to) || !validTime(at)) throw new Error("Неверная отметка или время проверки.");
  if (observation.review === to) return evidence;
  if (evidence.reviewHistory.events.length >= MAX_REVIEW_EVENTS)
    throw new Error("Достигнут лимит 512 изменений. Сохраните историю JSON; текущие отметки сохранены.");
  const event: ReviewEvent = {revision: evidence.reviewHistory.events.length + 1, observationId: id,
    from: observation.review, to, at, actor: "local-unverified-reviewer"};
  return {...reviewSegmentationEvidence(evidence, id, to), reviewHistory: {...evidence.reviewHistory, events: [...evidence.reviewHistory.events, event]}};
}

const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Неверный объект истории проверки.");
  return x as Record<string, unknown>;
};

/** Restore decisions only onto active verified Evidence. Imported measurements,
 * names, buffers, tokens and extra fields never replace the current source. */
export function parseEvidenceReviewHistory(raw: string, evidence: SegmentationEvidence): EvidenceReviewHistory {
  if (raw.length > MAX_REVIEW_JSON_BYTES || new TextEncoder().encode(raw).byteLength > MAX_REVIEW_JSON_BYTES)
    throw new Error("История превышает лимит 256 КБ.");
  let parsed: unknown;
  try {parsed = JSON.parse(raw);} catch {throw new Error("Файл истории не содержит корректный JSON.");}
  return normalizeEvidenceReviewHistory(parsed,evidence);
}

/** Object-side allowlisting avoids copying opaque fields in local reports. */
export function normalizeEvidenceReviewHistory(parsed: unknown, evidence: SegmentationEvidence): EvidenceReviewHistory {
  const r = object(parsed), b = object(r.binding), expected = binding(evidence);
  if (r.schema !== "opus-evidence-review/v1" || r.provenance !== "local-unverified" ||
    !Array.isArray(r.events) || r.events.length > MAX_REVIEW_EVENTS) throw new Error("Неподдерживаемая история проверки.");
  if (Object.entries(expected).some(([key, value]) => b[key] !== value))
    throw new Error("История относится к другому пакету, источнику, маске или весам.");
  const states = new Map(evidence.observations.map(o => [o.observationId, "unreviewed" as EvidenceDecision]));
  const events = r.events.map((value, i): ReviewEvent => {
    const e = object(value);
    if (e.revision !== i + 1 || typeof e.observationId !== "string" || !states.has(e.observationId) ||
      !allowed(e.from) || !allowed(e.to) || e.from === e.to || states.get(e.observationId) !== e.from ||
      !validTime(e.at) || e.actor !== "local-unverified-reviewer")
      throw new Error("Нарушена последовательность изменений или указан недопустимый статус.");
    states.set(e.observationId, e.to);
    return {revision: i + 1, observationId: e.observationId, from: e.from, to: e.to, at: e.at, actor: "local-unverified-reviewer"};
  });
  return {schema: "opus-evidence-review/v1", provenance: "local-unverified", binding: expected, events};
}

/** Only identical/extended journals are accepted: never silently erase, roll
 * back or fork existing local history. Fresh active Evidence can restore a file.
 * Timestamps are declarations; revisions, not clocks, establish ordering. */
export function restoreEvidenceReview(evidence: ReviewedEvidence, raw: string): ReviewedEvidence {
  const history = parseEvidenceReviewHistory(raw, evidence), previous = evidence.reviewHistory.events;
  if (history.events.length < previous.length)
    throw new Error("Импорт не продолжает текущую историю. Более старая версия отклонена; отметки сохранены.");
  if (previous.some((event, i) => JSON.stringify(event) !== JSON.stringify(history.events[i])))
    throw new Error("Импорт не продолжает текущую историю. Расходящаяся версия отклонена; отметки сохранены.");
  const states = new Map(history.events.map(e => [e.observationId, e.to]));
  return {...evidence, observations: evidence.observations.map(o => ({...o, review: states.get(o.observationId) ?? "unreviewed"})), reviewHistory: history};
}
