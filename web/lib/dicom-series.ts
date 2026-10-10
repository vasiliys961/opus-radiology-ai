/**
 * Metadata-only DICOM Part 10 reader for study/series browsing (research prototype).
 * No patient tags or identifying descriptions are extracted, stored or displayed.
 * No pixel data is decoded here. Compatible with compressed little-endian Part 10 headers;
 * image decoding remains deliberately limited in dicom-lite.ts.
 */
export type TechnicalDicomMetadata = {
  sopInstanceUid: string | null;
  studyUid: string | null;
  seriesUid: string | null;
  frameOfReferenceUid: string | null;
  modality: string;
  instanceNumber: number | null;
  numberOfFrames: number | null;
  rows: number | null;
  columns: number | null;
  imagePositionPatient: [number, number, number] | null;
  imageOrientationPatient: [number, number, number, number, number, number] | null;
  pixelSpacing: [number, number] | null;
  transferSyntax: string;
};

export type SeriesMember = {
  id: string;
  name: string;
  metadata: TechnicalDicomMetadata;
};

export type DicomSeries = {
  key: string;
  label: string;
  modality: string;
  members: SeriesMember[];
  spatiallySorted: boolean;
  volumeReady: boolean;
  sliceSpacingMm: number | null;
  warning: string | null;
};

const LONG_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN']);
const IMPLICIT_LE = '1.2.840.10008.1.2';
const EXPLICIT_LE = '1.2.840.10008.1.2.1';
const BIG_ENDIAN = '1.2.840.10008.1.2.2';
const HEADER_BYTES = 512 * 1024;

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start + length > bytes.byteLength) throw new Error('Неполный DICOM-заголовок.');
  // UIDs and numeric DS/IS are ASCII; do not decode patient fields.
  let result = '';
  for (let j = start; j < start + length; j++) result += String.fromCharCode(bytes[j]);
  return result.replace(/\0/g, '').trim();
}

function numericVector(str: string, length: number): number[] | null {
  const values = str.split('\\').map((s) => Number(s.trim()));
  return values.length === length && values.every(Number.isFinite) ? values : null;
}

export function parseDicomSeriesHeader(buffer: ArrayBuffer): TechnicalDicomMetadata {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.byteLength < 132 || ascii(bytes, 128, 4) !== 'DICM') {
    throw new Error('Нет DICOM Part 10 сигнатуры.');
  }

  const result: TechnicalDicomMetadata = {
    sopInstanceUid: null, studyUid: null, seriesUid: null, frameOfReferenceUid: null,
    modality: '', instanceNumber: null, numberOfFrames: null, rows: null, columns: null,
    imagePositionPatient: null, imageOrientationPatient: null,
    pixelSpacing: null, transferSyntax: '',
  };
  let offset = 132;
  let explicit = true;
  let meta = true;

  while (offset + 8 <= bytes.byteLength) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    if (meta && group !== 0x0002) {
      meta = false;
      if (!result.transferSyntax || result.transferSyntax === BIG_ENDIAN) {
        throw new Error('Неизвестная или Big Endian кодировка DICOM.');
      }
      // Compressed transfer syntaxes still use Explicit VR Little Endian in the dataset.
      explicit = result.transferSyntax !== IMPLICIT_LE;
    }
    let length: number;
    let valueOffset: number;
    if (explicit) {
      const vr = ascii(bytes, offset + 4, 2);
      if (LONG_VRS.has(vr)) {
        if (offset + 12 > bytes.byteLength) throw new Error('Неполный заголовок DICOM.');
        valueOffset = offset + 12;
        length = view.getUint32(offset + 8, true);
      } else {
        valueOffset = offset + 8;
        length = view.getUint16(offset + 6, true);
      }
    } else {
      valueOffset = offset + 8;
      length = view.getUint32(offset + 4, true);
    }
    const tag = group * 65536 + element;
    // Never walk through pixel data. It may be huge or encapsulated.
    if (tag === 0x7fe00010) break;
    if (length === 0xffffffff) {
      throw new Error('DICOM с последовательностью неопределённой длины требует полноценного DICOM-декодера.');
    }
    if (valueOffset + length > bytes.byteLength) {
      throw new Error('Технические теги DICOM не поместились в окно чтения 512 КБ.');
    }
    const getText = () => ascii(bytes, valueOffset, length);
    switch (tag) {
      case 0x00020010: result.transferSyntax = getText(); break;
      case 0x00080060: result.modality = getText().slice(0, 16); break;
      case 0x00080018: result.sopInstanceUid = getText() || null; break;
      case 0x00280008: {
        const n = Number.parseInt(getText(), 10);
        result.numberOfFrames = Number.isFinite(n) && n > 0 ? n : null;
        break;
      }
      case 0x0020000d: result.studyUid = getText() || null; break;
      case 0x0020000e: result.seriesUid = getText() || null; break;
      case 0x00200052: result.frameOfReferenceUid = getText() || null; break;
      case 0x00200013: {
        const n = Number.parseInt(getText(), 10);
        result.instanceNumber = Number.isFinite(n) ? n : null;
        break;
      }
      case 0x00200032: {
        const v = numericVector(getText(), 3);
        if (v) result.imagePositionPatient = v as [number, number, number];
        break;
      }
      case 0x00200037: {
        const v = numericVector(getText(), 6);
        if (v) result.imageOrientationPatient = v as [number, number, number, number, number, number];
        break;
      }
      case 0x00280010: if (length >= 2) result.rows = view.getUint16(valueOffset, true); break;
      case 0x00280011: if (length >= 2) result.columns = view.getUint16(valueOffset, true); break;
      case 0x00280030: {
        const v = numericVector(getText(), 2);
        if (v && v.every((n) => n > 0)) result.pixelSpacing = v as [number, number];
        break;
      }
    }
    offset = valueOffset + length;
  }
  return result;
}

export async function readDicomSeriesHeader(file: File): Promise<TechnicalDicomMetadata> {
  return parseDicomSeriesHeader(await file.slice(0, HEADER_BYTES).arrayBuffer());
}

function normal(orientation: NonNullable<TechnicalDicomMetadata['imageOrientationPatient']>): [number, number, number] | null {
  const [rx, ry, rz, cx, cy, cz] = orientation;
  const rowLength = Math.hypot(rx, ry, rz);
  const columnLength = Math.hypot(cx, cy, cz);
  const dot = rx * cx + ry * cy + rz * cz;
  if (Math.abs(rowLength - 1) > 0.01 || Math.abs(columnLength - 1) > 0.01 || Math.abs(dot) > 0.01) return null;
  const [x, y, z] = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
  const magnitude = Math.hypot(x, y, z);
  if (!Number.isFinite(magnitude) || magnitude < 0.98 || magnitude > 1.02) return null;
  return [x / magnitude, y / magnitude, z / magnitude];
}

/**
 * A verified spatial ORDER is not enough for an un-resampled 3D VOLUME.
 * Keep the two flags separate; never silently invent missing slice geometry.
 */
function sortMembers(members: SeriesMember[]): {
  members: SeriesMember[];
  spatiallySorted: boolean;
  volumeReady: boolean;
  sliceSpacingMm: number | null;
  warning: string | null;
} {
  const result = [...members];
  const first = members[0]?.metadata;
  const orientation = first?.imageOrientationPatient;
  const axis = orientation ? normal(orientation) : null;
  let spatiallySorted = Boolean(axis && members.length > 1);
  if (spatiallySorted) {
    for (const {metadata: v} of members) {
      if (!v.imagePositionPatient || !v.imageOrientationPatient ||
        !v.imagePositionPatient.every(Number.isFinite) ||
        v.rows == null || v.columns == null || v.rows < 1 || v.columns < 1 ||
        v.rows !== first?.rows || v.columns !== first?.columns ||
        v.imageOrientationPatient.some((n, i) => !Number.isFinite(n) || Math.abs(n - orientation![i]) > 0.001)) {
        spatiallySorted = false;
        break;
      }
    }
  }
  let sliceSpacingMm: number | null = null;
  let volumeReady = false;
  let warning: string | null = null;
  if (spatiallySorted && axis) {
    const project = (m: SeriesMember) => m.metadata.imagePositionPatient!.reduce((acc, pos, i) => acc + pos * axis[i], 0);
    result.sort((a, b) => project(a) - project(b));
    const gaps = result.slice(1).map((m, i) => project(m) - project(result[i]));
    if (gaps.some((gap) => !Number.isFinite(gap) || gap < 0.01)) {
      spatiallySorted = false;
      warning = 'В серии совпадают или некорректны координаты срезов. Порядок условный; MPR/3D запрещены.';
    } else {
      const sortedGaps = [...gaps].sort((a, b) => a - b);
      const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
      sliceSpacingMm = median;
      const tolerance = Math.max(0.05, median * 0.05);
      const irregular = gaps.some((gap) => Math.abs(gap - median) > tolerance);
      const spacing = first?.pixelSpacing;
      const pixelSpacingValid = Boolean(spacing && spacing.every((v) => Number.isFinite(v) && v > 0) &&
        result.every(({metadata: v}) => v.pixelSpacing && v.pixelSpacing.every((n, i) => Number.isFinite(n) && Math.abs(n - spacing![i]) <= 0.01)));
      const duplicates = new Set(result.map((m) => m.metadata.sopInstanceUid).filter(Boolean)).size !==
        result.filter((m) => m.metadata.sopInstanceUid).length;
      const singleFrames = result.every((m) => (m.metadata.numberOfFrames ?? 1) === 1);
      const identifiable = Boolean(first?.studyUid && first.seriesUid && first.frameOfReferenceUid &&
        result.every((m) => m.metadata.sopInstanceUid));
      const singleModality = result.every((m) => m.metadata.modality === first?.modality);
      // A tilted acquisition can drift within the axial plane. Sorting still works,
      // but naive orthogonal 3D grids would misplace anatomy without resampling.
      const origin = result[0].metadata.imagePositionPatient!;
      const inPlaneDrift = result.some((m) => {
        const delta = m.metadata.imagePositionPatient!.map((p, i) => p - origin[i]);
        const along = delta.reduce((acc, pos, i) => acc + pos * axis[i], 0);
        return Math.hypot(...delta.map((d, i) => d - along * axis[i])) > 0.1;
      });
      volumeReady = result.length >= 3 && !irregular && pixelSpacingValid && !duplicates && singleFrames &&
        singleModality && !inPlaneDrift && identifiable;
      if (irregular) warning = 'Срезы отсортированы, но шаг между ними неравномерный. MPR/3D требуют проверки и ресэмплинга.';
      else if (!pixelSpacingValid) warning = 'Срезы отсортированы, но Pixel Spacing отсутствует или различается. MPR/3D недоступны.';
      else if (duplicates) warning = 'Повторяющиеся SOP Instance UID: возможны дубли кадров. MPR/3D недоступны.';
      else if (!singleFrames) warning = 'Обнаружен мультифреймовый DICOM: требуется полноценный декодер для MPR/3D.';
      else if (!singleModality) warning = 'В одной серии обнаружены разные модальности. MPR/3D недоступны.';
      else if (inPlaneDrift) warning = 'Смещение срезов в плоскости (наклон/движение): перед MPR/3D нужна коррекция геометрии.';
      else if (!identifiable) warning = 'Недостаточно DICOM UID (исследования/серии/кадров). Требуется проверка перед построением объёма.';
      else if (result.length < 3) warning = 'Для подтверждения равномерности объёма требуется не менее трёх срезов.';
    }
  }
  if (!spatiallySorted) {
    result.sort((a, b) => (a.metadata.instanceNumber ?? Number.MAX_SAFE_INTEGER) -
      (b.metadata.instanceNumber ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
    warning ??= members.length > 1
      ? 'Геометрия серии не подтверждена. Порядок срезов условный (Instance Number/имя), не подходит для 3D и измерений.'
      : null;
  }
  if (members.length === 1 && (first?.numberOfFrames ?? 1) > 1) {
    warning = 'Мультифреймовый DICOM: текущий браузерный декодер не отображает отдельные кадры.';
  }
  return { members: result, spatiallySorted, volumeReady, sliceSpacingMm, warning };
}

/** Group strictly by study + series + frame of reference; missing UIDs stay isolated. */
export function groupDicomSeries(members: SeriesMember[]): DicomSeries[] {
  const groups = new Map<string, SeriesMember[]>();
  for (const m of members) {
    const d = m.metadata;
    const key = d.studyUid && d.seriesUid
      ? `${d.studyUid}\u0001${d.seriesUid}\u0001${d.frameOfReferenceUid ?? 'unknown'}`
      : `unknown\u0001${m.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  return Array.from(groups.entries()).map(([key, data], i) => {
    const sorted = sortMembers(data);
    return {
      key,
      label: `Серия ${i + 1} · ${data[0].metadata.modality || 'DICOM'} · ${data.length} срез(ов)`,
      modality: data[0].metadata.modality,
      ...sorted,
    };
  });
}
