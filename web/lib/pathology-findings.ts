/**
 * Source-bound pathology candidates and clinician research review.
 *
 * AI proposals, reference annotation, and physician assessments are separate.
 * This does NOT establish a DICOM/SOP binding, a diagnosis, or a clinical audit.
 * No model execution, patient upload, storage, or network activity.
 */
export type PathologyDecision = "unreviewed" | "needs_image_review" | "rejected_by_reviewer";
export type PathologyAssessment = {
  decision: PathologyDecision;
  note: string;
  reviewerMeasuredDiameterMm: number | null;
};
export type ModelCandidate = {
  candidateIndex: number;
  centerMonaiWorldMm: number[];
  extentMm: number[];
  rawClassificationScore: number;
  coordinateFrameVerifiedAgainstSource: false;
};
export type MonaiResearchReport = {
  schema: "opus-monai-luna16-real-single-ct-inference/v1";
  publicStudy: {
    sourceSeriesIdSha256: string;
    sourceMhdSha256: string;
    sourceRawSha256: string;
    dimensions: number[];
    luna16GroundTruthNoduleCount: number;
  };
  coverage: {
    sourceFullCtProcessed: boolean;
    sourceWorldCoordinateVerification: string;
  };
  model: {
    id: string;
    version: string;
    weightsSha256: string;
    modelCheckpointActualSha256Verified: boolean;
  };
  candidates: ModelCandidate[];
  readyForClinicalUse: false;
};
export type PathologyFinding = {
  findingId: string;
  task: "ct_lung_nodule";
  modality: "CT";
  anatomy: "lung";
  candidateIndex: number;
  source: {
    publicStudyIdentitySha256: string;
    sourceHeaderSha256: string;
    sourcePixelsSha256: string;
    seriesInstanceUid: null;
    sopInstanceUid: null;
    sourceSliceIndex: null;
    sourceBinding: "public_metaimage_only_not_dicom_verified";
  };
  localization: {
    coordinateFrame: "monai_world_unverified";
    modelWorldCenterMm: [number, number, number];
    modelBoundingBoxMm: [number, number, number];
    verifiedDicomLpsMm: null;
    verifiedSourceVoxel: null;
  };
  model: {
    id: string;
    version: string;
    weightsSha256: string;
    rawUncalibratedScore: number;
  };
  assessment: PathologyAssessment;
};
export type PathologyReviewEvent = {
  revision: number;
  findingId: string;
  previous: PathologyAssessment;
  next: PathologyAssessment;
  at: string;
  actor: "local_unverified_reviewer";
};
export type PathologyReviewDraft = {
  schema: "opus-pathology-physician-research-draft/v1";
  status: "unsigned_research_draft";
  sourceScope: "public_luna16_reference_only";
  caseBinding: {
    publicStudyIdentitySha256: string;
    sourceHeaderSha256: string;
    sourcePixelsSha256: string;
    modelId: string;
    modelVersion: string;
    weightsSha256: string;
  };
  coverage: {
    fullPublicCtProcessed: boolean;
    modelCoordinatesToOriginalDicomVerified: false;
    assessedAllPathologies: false;
  };
  reviewerIdentity: "not_authenticated";
  findings: PathologyFinding[];
  events: PathologyReviewEvent[];
  physicianSynthesis: string;
  automatedDiagnosis: false;
  clinicallyValidated: false;
  absenceOfDiseaseEstablished: false;
  externalTransmission: false;
  limitations: string[];
};
const SHA = /^[a-f0-9]{64}$/;
const textField = (v: unknown, max: number, name: string) => {
  if (typeof v !== "string" || v.length > max || v.includes("\u0000"))
    throw Error("Некорректное поле: " + name);
  return v.trim();
};
const triple = (v: unknown, positive: boolean, name: string): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3 ||
    v.some(x => typeof x !== "number" || !Number.isFinite(x) || (positive && x <= 0)))
    throw Error("Неверная геометрия: " + name);
  return [v[0], v[1], v[2]];
};
const checkedSha = (s: unknown, name: string) => {
  if (typeof s !== "string" || !SHA.test(s)) throw Error("Отсутствует SHA-256: " + name);
  return s;
};
const defaultAssessment = (): PathologyAssessment => ({
  decision: "unreviewed", note: "", reviewerMeasuredDiameterMm: null,
});
export function startPathologyReview(report: MonaiResearchReport): PathologyReviewDraft {
  if (report.schema !== "opus-monai-luna16-real-single-ct-inference/v1" ||
      report.readyForClinicalUse !== false ||
      report.model.modelCheckpointActualSha256Verified !== true ||
      report.coverage.sourceFullCtProcessed !== true ||
      report.coverage.sourceWorldCoordinateVerification !== "not_yet_completed" ||
      !Array.isArray(report.candidates) || report.candidates.length > 300)
    throw Error("Отчёт не соответствует исследовательскому режиму.");
  const caseBinding = {
    publicStudyIdentitySha256: checkedSha(report.publicStudy.sourceSeriesIdSha256, "study"),
    sourceHeaderSha256: checkedSha(report.publicStudy.sourceMhdSha256, "header"),
    sourcePixelsSha256: checkedSha(report.publicStudy.sourceRawSha256, "pixels"),
    modelId: textField(report.model.id, 160, "model",),
    modelVersion: textField(report.model.version, 80, "model version"),
    weightsSha256: checkedSha(report.model.weightsSha256, "weights"),
  };
  if (!caseBinding.modelId || !caseBinding.modelVersion ||
      !Array.isArray(report.publicStudy.dimensions) ||
      report.publicStudy.dimensions.length !== 3 ||
      report.publicStudy.dimensions.some(x => !Number.isSafeInteger(x) || x < 1))
    throw Error("Неполный паспорт модели или КТ.");
  const seen = new Set<number>();
  const findings = report.candidates.map(c => {
    if (!Number.isSafeInteger(c.candidateIndex) || c.candidateIndex < 0 ||
        seen.has(c.candidateIndex) ||
        c.coordinateFrameVerifiedAgainstSource !== false ||
        typeof c.rawClassificationScore !== "number" ||
        !Number.isFinite(c.rawClassificationScore) ||
        c.rawClassificationScore < 0 || c.rawClassificationScore > 1)
      throw Error("Повтор или повреждение кандидата MONAI.");
    seen.add(c.candidateIndex);
    const center = triple(c.centerMonaiWorldMm, false, "center");
    const extent = triple(c.extentMm, true, "bbox");
    return {
      findingId: "ct-lung-nodule/" + caseBinding.publicStudyIdentitySha256.slice(0,16) + "/" + c.candidateIndex,
      task: "ct_lung_nodule" as const, modality: "CT" as const, anatomy: "lung" as const,
      candidateIndex: c.candidateIndex,
      source: {
        publicStudyIdentitySha256: caseBinding.publicStudyIdentitySha256,
        sourceHeaderSha256: caseBinding.sourceHeaderSha256,
        sourcePixelsSha256: caseBinding.sourcePixelsSha256,
        seriesInstanceUid: null, sopInstanceUid: null, sourceSliceIndex: null,
        sourceBinding: "public_metaimage_only_not_dicom_verified" as const,
      },
      localization: {
        coordinateFrame: "monai_world_unverified" as const,
        modelWorldCenterMm: center, modelBoundingBoxMm: extent,
        verifiedDicomLpsMm: null, verifiedSourceVoxel: null,
      },
      model: {
        id: caseBinding.modelId, version: caseBinding.modelVersion,
        weightsSha256: caseBinding.weightsSha256,
        rawUncalibratedScore: c.rawClassificationScore,
      },
      assessment: defaultAssessment(),
    };
  });
  return {
    schema: "opus-pathology-physician-research-draft/v1",
    status: "unsigned_research_draft", sourceScope: "public_luna16_reference_only",
    caseBinding, coverage: {
      fullPublicCtProcessed: true,
      modelCoordinatesToOriginalDicomVerified: false,
      assessedAllPathologies: false,
    },
    reviewerIdentity: "not_authenticated", findings, events: [], physicianSynthesis: "",
    automatedDiagnosis: false, clinicallyValidated: false,
    absenceOfDiseaseEstablished: false, externalTransmission: false,
    limitations: [
      "Изображения и MONAI world координаты пока не связаны с исходными DICOM/SOP UID.",
      "Решения и ручные измерения введены локально; личность и квалификация автора не проверены.",
      "Бокс модели не является измеренным диаметром узла. Score модели не является клинической вероятностью.",
      "Одно открытое исследование не подтверждает чувствительность, специфичность или FROC.",
      "Необнаружение очага не означает отсутствие заболевания.",
      "Документ не подписан, не является клиническим заключением и не отправляется на сервер.",
    ],
  };
}
function assessment(input: PathologyAssessment): PathologyAssessment {
  if (!input || !["unreviewed", "needs_image_review", "rejected_by_reviewer"].includes(input.decision))
    throw Error("Неподдерживаемое решение врача.");
  const diameter = input.reviewerMeasuredDiameterMm;
  if (diameter !== null && (typeof diameter !== "number" ||
      !Number.isFinite(diameter) || diameter <= 0 || diameter > 300))
    throw Error("Некорректный диаметр: допустимо 0–300 мм, либо не указан.");
  return {
    decision: input.decision,
    note: textField(input.note, 1500, "review note"),
    reviewerMeasuredDiameterMm: diameter,
  };
}
export function recordPathologyAssessment(
  draft: PathologyReviewDraft, findingId: string,
  proposed: PathologyAssessment, at: string,
): PathologyReviewDraft {
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)
    throw Error("Неверное время отметки.");
  const index = draft.findings.findIndex(f => f.findingId === findingId);
  if (index < 0) throw Error("Кандидат не относится к текущему исследованию.");
  const next = assessment(proposed);
  const previous = draft.findings[index].assessment;
  if (next.decision === previous.decision &&
      next.note === previous.note &&
      next.reviewerMeasuredDiameterMm === previous.reviewerMeasuredDiameterMm) return draft;
  if (draft.events.length >= 512) throw Error("Лимит 512 записей достигнут. Сохраните текущий черновик.");
  const event: PathologyReviewEvent = {
    revision: draft.events.length + 1, findingId, previous, next, at,
    actor: "local_unverified_reviewer",
  };
  return {
    ...draft,
    findings: draft.findings.map((f, i) => i === index ? {...f, assessment: next} : f),
    events: [...draft.events, event],
  };
}
export function setPathologySynthesis(draft: PathologyReviewDraft, note: string): PathologyReviewDraft {
  return {...draft, physicianSynthesis: textField(note, 4000, "clinical synthesis")};
}
