import type { DicomSeries, SeriesMember } from "./dicom-series";

export type VisionFramePlanEntry = {
  fileId: string;
  seriesKey: string;
  seriesUid: string;
  sopInstanceUid: string;
  frameIndex: 0;
  slicePositionMm: number | null;
  ordinal: number;
  totalFrames: number;
};
export type VisionFramePlan = {
  schema: "opus-vision-frame-plan/v1";
  status: "ready-for-local-preview" | "blocked";
  selection: "uniform-sampling" | "verified-candidate-sampling" | "none";
  coverage: "sampled-frames-only" | "not-assessed";
  transmissionPermitted: false;
  deidentificationVerified: false;
  seriesKey: string | null;
  frames: VisionFramePlanEntry[];
  blockers: string[];
  warnings: string[];
};

export const MAX_VISION_SAMPLE_FRAMES = 4;
const validUid = (value: string | null): value is string => !!value && value.length <= 64 && /^\d+(?:\.\d+)+$/.test(value);
function position(member: SeriesMember): number | null {
  const point = member.metadata.imagePositionPatient;
  const orient = member.metadata.imageOrientationPatient;
  if (!point || !orient || !point.every(Number.isFinite) || !orient.every(Number.isFinite)) return null;
  const [rx, ry, rz, cx, cy, cz] = orient;
  const normal = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
  const magnitude = Math.hypot(...normal);
  if (!Number.isFinite(magnitude) || magnitude < 0.98 || magnitude > 1.02) return null;
  return point.reduce((v, c, i) => v + c * normal[i] / magnitude, 0);
}
export function uniformIndices(length: number, requested: number): number[] {
  if (!Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(requested) ||
      requested < 1 || requested > MAX_VISION_SAMPLE_FRAMES) throw new Error("Invalid sample boundaries");
  const count = Math.min(length, requested);
  if (count === 1) return [Math.floor((length - 1) / 2)];
  return Array.from({length: count}, (_, i) => Math.round(i * (length - 1) / (count - 1)));
}
/**
 * Local-only frame manifest. It does NOT render images, anonymize them,
 * evaluate disease or call any external model.
 */
export function planVisionFrameSamples(
  series: readonly DicomSeries[], preferredSeriesKey: string | null = null, count = MAX_VISION_SAMPLE_FRAMES,
 focusSliceIndex: number | null = null,
): VisionFramePlan {
  if (!Number.isInteger(count) || count < 1 || count > MAX_VISION_SAMPLE_FRAMES)
    throw new Error("Invalid requested sample count");
  const preferred = preferredSeriesKey === null ? undefined : series.find(s => s.key === preferredSeriesKey);
  const selected = preferredSeriesKey !== null ? preferred :
    series.find(s => s.volumeReady && (s.modality === "CT" || s.modality === "MR"));
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!selected) blockers.push(
    preferredSeriesKey !== null ? "Выбранная серия отсутствует." :
    "Нет геометрически подтверждённой КТ/МРТ-серии. Сперва загрузите подходящие DICOM.",
  );
  else {
    if (!["CT", "MR"].includes(selected.modality))
      blockers.push("Только КТ или МРТ.");
    if (!selected.volumeReady || !selected.spatiallySorted)
      blockers.push("Геометрия срезов не подтверждена. Выборка запрещена.");
    if (!selected.members.length)
      blockers.push("Нет DICOM-кадров.");
    const uid = selected.members[0]?.metadata.seriesUid;
    if (!validUid(uid))
      blockers.push("Отсутствует корректный SeriesInstanceUID.");
    const sops = new Set<string>();
    const referenceStudy = selected.members[0]?.metadata.studyUid;
    const referenceFrame = selected.members[0]?.metadata.frameOfReferenceUid;
    for (const member of selected.members) {
      const m = member.metadata;
      if (!validUid(m.sopInstanceUid) || m.seriesUid !== uid ||
          !validUid(m.studyUid) || m.studyUid !== referenceStudy ||
          !validUid(m.frameOfReferenceUid) || m.frameOfReferenceUid !== referenceFrame ||
          m.modality !== selected.modality || (m.numberOfFrames ?? 1) !== 1) {
        blockers.push("Источник содержит неподдерживаемый много-кадровый DICOM или несовпадающие идентификаторы.");
        break;
      }
      if (sops.has(m.sopInstanceUid)) {
        blockers.push("Повторяющийся SOPInstanceUID.");
        break;
      }
      sops.add(m.sopInstanceUid);
      if (position(member) === null) {
        blockers.push("Неполная физическая геометрия кадра.");
        break;
      }
    }
    if (selected.members.length > count)
      warnings.push("Выбираются лишь отдельные кадры; этот набор не описывает весь объём исследования.");
    warnings.push("DICOM-коды анатомической области, контрастная фаза, полнота протокола и патологии не оцениваются.");
  }
  if (!selected || blockers.length) return {
    schema: "opus-vision-frame-plan/v1", status: "blocked", selection: "none", coverage: "not-assessed",
    transmissionPermitted: false, deidentificationVerified: false, seriesKey: selected?.key ?? null,
    frames: [], blockers, warnings,
  };
  const ids = uniformIndices(selected.members.length, count);
  const focusValid=focusSliceIndex!==null&&Number.isSafeInteger(focusSliceIndex)&&
    focusSliceIndex>=0&&focusSliceIndex<selected.members.length;
  if(focusValid&&!ids.includes(focusSliceIndex)){
    const nearest=ids.reduce((best,index,i)=>
      Math.abs(index-focusSliceIndex)<Math.abs(ids[best]-focusSliceIndex)?i:best,0);
    ids[nearest]=focusSliceIndex;
    ids.sort((a,b)=>a-b);
  }
  return {
    schema: "opus-vision-frame-plan/v1", status: "ready-for-local-preview",
    selection: focusValid?"verified-candidate-sampling":"uniform-sampling", coverage: "sampled-frames-only",
    transmissionPermitted: false, deidentificationVerified: false, seriesKey: selected.key,
    frames: ids.map(idx => {
      const member = selected.members[idx];
      return {
        fileId: member.id, seriesKey: selected.key,
        seriesUid: member.metadata.seriesUid!, sopInstanceUid: member.metadata.sopInstanceUid!,
        frameIndex: 0, slicePositionMm: position(member), ordinal: idx + 1,
        totalFrames: selected.members.length,
      };
    }),
    blockers, warnings,
  };
}
