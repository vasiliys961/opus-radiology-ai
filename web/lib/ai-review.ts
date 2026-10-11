import type { DicomSeries } from "./dicom-series";
import { validateEvidenceJson, type EvidenceJson } from "./evidence-json";

/**
 * Local-only, untrusted research-result viewer.
 * A source UID match is necessary but not patient identity certification.
 */
export type SourceImageRef = {
  imageId: string;
  seriesUid: string;
  sopInstanceUid: string | null;
  frameIndex: number;
  slicePositionMm: number | null;
  viewLabel: string;
  mimeType: "image/png" | "image/jpeg";
};
export type ReviewableOrchestraResult = {
  schema: "opus-orchestra/v1";
  provider: "polza" | "openrouter";
  modality: "CT" | "MR";
  visionModel: string;
  clinicalModel: string;
  clinicalStatus: "unverified_research_draft";
  sourceImages: SourceImageRef[];
  evidence: EvidenceJson;
  clinicalDraft: { summary: string; limitations: string[] };
};
export type BoundFinding = {
  findingId: string;
  memberId: string;
  sourceLabel: string;
  seriesKey: string;
  sign: string;
  anatomy: string;
  needsRecheck: boolean;
};
const txt = (x: unknown, n: number): x is string =>
  typeof x === "string" && x.length > 0 && x.length <= n;
const optionalNum = (x: unknown): x is number | null =>
  x === null || (typeof x === "number" && Number.isFinite(x));
const warnings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 20 &&
  v.every(x => typeof x === "string" && x.length <= 500);

export function parseReviewableOrchestraResult(raw: string): ReviewableOrchestraResult {
  if (raw.length > 512_000) throw new Error("Паспорт AI слишком большой (максимум 512 КБ).");
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("Файл не содержит корректный JSON."); }
  if (!value || typeof value !== "object") throw new Error("Некорректный AI-результат.");
  const r = value as Record<string, unknown>;
  if (r.schema !== "opus-orchestra/v1" || r.clinicalStatus !== "unverified_research_draft" ||
      !["polza", "openrouter"].includes(String(r.provider)) ||
      !["CT", "MR"].includes(String(r.modality)) ||
      !txt(r.visionModel, 160) || !txt(r.clinicalModel, 160) ||
      !validateEvidenceJson(r.evidence) || r.evidence.modality !== r.modality)
    throw new Error("Неподдерживаемый контракт AI-находок или отсутствует происхождение результата.");
  const draft = r.clinicalDraft;
  if (!draft || typeof draft !== "object" ||
      !txt((draft as Record<string, unknown>).summary, 6000) ||
      !warnings((draft as Record<string, unknown>).limitations))
    throw new Error("Черновик клинического анализа не прошёл проверку.");
  if (!Array.isArray(r.sourceImages) || r.sourceImages.length < 1 || r.sourceImages.length > 4)
    throw new Error("Нет списка исходных кадров или их слишком много.");
  const imageIds = new Set<string>();
  const images = r.sourceImages as Array<Record<string, unknown>>;
  for (const f of images) {
    if (!f || !txt(f.imageId, 100) || imageIds.has(f.imageId) ||
        !txt(f.seriesUid, 180) ||
        !(f.sopInstanceUid === null || txt(f.sopInstanceUid, 180)) ||
        typeof f.frameIndex !== "number" || !Number.isInteger(f.frameIndex) || f.frameIndex < 0 ||
        !optionalNum(f.slicePositionMm) || !txt(f.viewLabel, 100) ||
        !["image/png", "image/jpeg"].includes(String(f.mimeType)) ||
        Object.hasOwn(f, "base64")) throw new Error("Некорректный паспорт исходных изображений.");
    imageIds.add(f.imageId);
  }
  const sourceImages = r.sourceImages as SourceImageRef[];
  for (const f of r.evidence.findings) {
    const anchored = sourceImages.some(image =>
      image.seriesUid === f.source.seriesUid &&
      image.sopInstanceUid !== null &&
      image.sopInstanceUid === f.source.sopInstanceUid &&
      image.frameIndex === f.source.frameIndex &&
      image.slicePositionMm === f.source.slicePositionMm);
    if (!anchored) throw new Error("AI-находка не связана с переданным исходным кадром.");
  }
  if (r.evidence.seriesReviewed.some(uid =>
    !sourceImages.some(f => f.seriesUid === uid)))
    throw new Error("Заявлена серия вне списка переданных кадров.");
  return r as ReviewableOrchestraResult;
}

export function bindFindingsToLocalDicom(
  result: ReviewableOrchestraResult, series: readonly DicomSeries[],
): BoundFinding[] {
  const bySeries = new Map<string, DicomSeries>();
  for (const group of series) {
    const uid = group.members[0]?.metadata.seriesUid;
    if (uid) {
      if (bySeries.has(uid)) throw new Error("Повторяющийся SeriesInstanceUID в исследовании.");
      bySeries.set(uid, group);
    }
  }
  if (series.length === 0) throw new Error("Сначала загрузите исходное DICOM-исследование.");
  for (const uid of result.evidence.seriesReviewed) {
    if (!bySeries.has(uid)) throw new Error("Исходная серия AI-результата не загружена.");
  }
  const links: BoundFinding[] = [];
  for (const finding of result.evidence.findings) {
    const group = bySeries.get(finding.source.seriesUid);
    if (!group || group.modality.toUpperCase() !== result.modality)
      throw new Error("Исходная серия или модальность не совпадает.");
    const matches = group.members.filter(m =>
      finding.source.sopInstanceUid !== null &&
      m.metadata.sopInstanceUid === finding.source.sopInstanceUid);
    if (matches.length !== 1) throw new Error("Невозможно однозначно сопоставить SOPInstanceUID.");
    const member = matches[0];
    if (finding.source.frameIndex !== 0 || (member.metadata.numberOfFrames ?? 1) !== 1)
      throw new Error("Связь с кадрами много-кадрового DICOM пока не поддерживается.");
    // Do not claim physical location verified merely from matching UIDs.
    links.push({
      findingId: finding.findingId, memberId: member.id,
      sourceLabel: member.name, seriesKey: group.key,
      sign: finding.sign, anatomy: finding.anatomy,
      needsRecheck: finding.status === "requires_recheck",
    });
  }
  return links;
}
