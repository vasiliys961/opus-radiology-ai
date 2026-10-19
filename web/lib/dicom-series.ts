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
  /** Technical pixel value transformation; never assume absent values are 1/0. */
  rescaleSlope?:number|null;
  rescaleIntercept?:number|null;
  /** Only code HU is retained; other known rescale units become OTHER. */
  rescaleUnit?: "HU"|"OTHER"|"UNSPECIFIED";
  transferSyntax: string;
  /** Only exact allowlisted anatomical codes. Never store raw DICOM free text. */
  bodyRegion?: "HEAD" | "NECK" | "CHEST" | "ABDOMEN" | "PELVIS" | "SPINE" | "EXTREMITY" | null;
  /** Derived from ImageType code tokens, not SeriesDescription or ProtocolName. */
  imageRole?: "LOCALIZER" | "DERIVED" | "PRIMARY" | "UNKNOWN";
  /** Standard MR scanning sequence codes, not clinical MRI weighting. */
  mrSequenceCodes?: ("SE" | "GR" | "IR" | "EP")[];
  repetitionTimeMs?: number | null;
  echoTimeMs?: number | null;
  inversionTimeMs?: number | null;
  sliceThicknessMm?: number | null;
  /** True only if the ContrastBolusAgent tag has a nonempty value; absence means unknown. */
  contrastAgentDeclared?: boolean;
  /** DICOM privacy hints. NO is a declaration, NOT proof of anonymization. */
  burnedInAnnotation?: "YES" | "NO" | "UNKNOWN";
  recognizableVisualFeatures?: "YES" | "NO" | "UNKNOWN";
  patientIdentityRemoved?: "YES" | "NO" | "UNKNOWN";
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
  /** Explicit local subvolume; original identities/coordinates stay unchanged. */
  selection?: {startIndex:number;endIndex:number;sourceFrameCount:number};
};

const LONG_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN']);
const IMPLICIT_LE = '1.2.840.10008.1.2';
const EXPLICIT_LE = '1.2.840.10008.1.2.1';
const BIG_ENDIAN = '1.2.840.10008.1.2.2';
const HEADER_BYTES = 512 * 1024;
type Region = NonNullable<TechnicalDicomMetadata["bodyRegion"]>;
const ALLOWED_REGIONS: Readonly<Record<string, Region>> = {
  HEAD:"HEAD", BRAIN:"HEAD", NECK:"NECK",
  CHEST:"CHEST", THORAX:"CHEST", LUNG:"CHEST",
  ABDOMEN:"ABDOMEN", ABD:"ABDOMEN",
  PELVIS:"PELVIS", PELV:"PELVIS",
  SPINE:"SPINE", C_SPINE:"SPINE", T_SPINE:"SPINE", L_SPINE:"SPINE",
  EXTREMITY:"EXTREMITY", LEG:"EXTREMITY", ARM:"EXTREMITY",
};
const allowedRegion = (raw: string | null): Region | null =>
  raw && Object.hasOwn(ALLOWED_REGIONS, raw.trim().toUpperCase()) ?
    ALLOWED_REGIONS[raw.trim().toUpperCase()] : null;
function imageRole(raw: string | null): NonNullable<TechnicalDicomMetadata["imageRole"]> {
  const tokens = (raw ?? "").trim().toUpperCase().split("\\").map(s=>s.trim());
  if (tokens.some(s => ["LOCALIZER","SCOUT","SURVEY"].includes(s))) return "LOCALIZER";
  if (tokens.includes("DERIVED") || tokens.includes("SECONDARY")) return "DERIVED";
  if (tokens.includes("ORIGINAL") && tokens.includes("PRIMARY")) return "PRIMARY";
  return "UNKNOWN";
}
function scanCodes(raw: string | null): NonNullable<TechnicalDicomMetadata["mrSequenceCodes"]> {
  const codes = (raw ?? "").trim().toUpperCase().split("\\");
  return [...new Set(codes.filter((c): c is "SE"|"GR"|"IR"|"EP" =>
    c==="SE" || c==="GR" || c==="IR" || c==="EP"))];
}
function privacyFlag(raw: string | null): "YES" | "NO" | "UNKNOWN" {
  return raw === "YES" || raw === "NO" ? raw : "UNKNOWN";
}
function boundedDs(raw: string | null, max = 1_000_000): number | null {
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start + length > bytes.byteLength) throw new Error('Неполный DICOM-заголовок.');
  // UIDs and numeric DS/IS are ASCII; do not decode patient fields.
  let result = '';
  for (let j = start; j < start + length; j++) result += String.fromCharCode(bytes[j]);
  return result.replace(/\0/g, '').trim();
}

/** DICOM DS values are ASCII decimals. Empty components must never become 0:
 * Number("") and Number(" ") both return zero and can invent image geometry.
 */
function numericVector(str: string, length: number): number[] | null {
  const parts = str.split('\\');
  if (parts.length !== length) return null;
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const values: number[] = [];
  for (const part of parts) {
    const value = part.trim();
    if (!decimal.test(value)) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    values.push(parsed);
  }
  return values;
}
/** Allowlist only numerical HU calibration, reject missing, overflow, zero-slope. */
function ctTransformNumber(value:string|null,kind:"slope"|"intercept"):number|null{
  if(value===null)return null;
  const parsed=numericVector(value,1)?.[0];
  if(parsed===undefined||!Number.isFinite(parsed))return null;
  return kind==="slope"?
    parsed>0 && parsed<=1024?parsed:null:
    Math.abs(parsed)<=65536?parsed:null;
}
function rescaleUnit(raw:string|null):"HU"|"OTHER"|"UNSPECIFIED"{
  return raw===null?"UNSPECIFIED":raw.toUpperCase()==="HU"?"HU":"OTHER";
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
    pixelSpacing: null, rescaleSlope:null,rescaleIntercept:null,rescaleUnit:'UNSPECIFIED',transferSyntax: '',
    bodyRegion: null, imageRole: "UNKNOWN", mrSequenceCodes: [],
    repetitionTimeMs:null, echoTimeMs:null, inversionTimeMs:null, sliceThicknessMm:null,
    contrastAgentDeclared:false,
    burnedInAnnotation:"UNKNOWN", recognizableVisualFeatures:"UNKNOWN",
    patientIdentityRemoved:"UNKNOWN",
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
      case 0x00080008: result.imageRole = imageRole(getText()); break;
      case 0x00180015: result.bodyRegion = allowedRegion(getText()); break;
      case 0x00180020: result.mrSequenceCodes = scanCodes(getText()); break;
      case 0x00180080: result.repetitionTimeMs = boundedDs(getText()); break;
      case 0x00180081: result.echoTimeMs = boundedDs(getText()); break;
      case 0x00180082: result.inversionTimeMs = boundedDs(getText()); break;
      case 0x00180050: result.sliceThicknessMm = boundedDs(getText()); break;
      case 0x00180010: result.contrastAgentDeclared = length > 0 && getText().length > 0; break;
      case 0x00281052: result.rescaleIntercept=ctTransformNumber(getText(),"intercept"); break;
      case 0x00281053: result.rescaleSlope=ctTransformNumber(getText(),"slope"); break;
      case 0x00281054: result.rescaleUnit=rescaleUnit(getText()); break;
      case 0x00280301: result.burnedInAnnotation = privacyFlag(getText()); break;
      case 0x00280302: result.recognizableVisualFeatures = privacyFlag(getText()); break;
      case 0x00120062: result.patientIdentityRemoved = privacyFlag(getText()); break;
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

/**
 * Fallback for real-world Part 10 studies with SQ/undefined-length structures,
 * and raw (no Part 10 preamble) DICOM data sets. The small handwritten parser
 * above is kept for cheap happy-path indexing, but must not be the final word.
 *
 * We ask dicom-parser to stop BEFORE Pixel Data: compressed pixel streams are
 * not decoded and patient-identifying tags are never returned or logged.
 */
async function parseComplexDicomHeader(buffer: ArrayBuffer): Promise<TechnicalDicomMetadata> {
  const parserModule = await import('dicom-parser');
  const dicomParser = parserModule.default ?? parserModule;
  const bytes = new Uint8Array(buffer);
  const hasPart10 = bytes.length >= 132 &&
    bytes[128] === 68 && bytes[129] === 73 && bytes[130] === 67 && bytes[131] === 77;
  const looksExplicit = bytes.length >= 8 &&
    bytes[4] >= 65 && bytes[4] <= 90 && bytes[5] >= 65 && bytes[5] <= 90;
  // Only the DICOM-standard transfer syntaxes below are inferable for raw data
  // without File Meta Information. Never guess a compressed transfer syntax.
  const rawSyntax = looksExplicit ? EXPLICIT_LE : IMPLICIT_LE;
  const dataSet = dicomParser.parseDicom(bytes, {
    untilTag: 'x7fe00010',
    ...(hasPart10 ? {} : { TransferSyntaxUID: rawSyntax }),
  });
  const str = (tag: string) => dataSet.string(tag)?.trim() || null;
  const number = (tag: string): number | null => {
    const value = str(tag);
    if (value === null) return null;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  };
  const vector = (tag: string, count: number) => {
    const value = str(tag);
    return value === null ? null : numericVector(value, count);
  };
  const spacing = vector('x00280030', 2);
  const frames = number('x00280008');
  const rows = dataSet.uint16('x00280010');
  const columns = dataSet.uint16('x00280011');
  const result: TechnicalDicomMetadata = {
    sopInstanceUid: str('x00080018'),
    studyUid: str('x0020000d'),
    seriesUid: str('x0020000e'),
    frameOfReferenceUid: str('x00200052'),
    modality: str('x00080060')?.slice(0, 16) ?? '',
    instanceNumber: number('x00200013'),
    numberOfFrames: frames !== null && frames > 0 ? frames : null,
    rows: rows && rows > 0 ? rows : null,
    columns: columns && columns > 0 ? columns : null,
    imagePositionPatient: vector('x00200032', 3) as TechnicalDicomMetadata['imagePositionPatient'],
    imageOrientationPatient: vector('x00200037', 6) as TechnicalDicomMetadata['imageOrientationPatient'],
    pixelSpacing: spacing?.every((v) => v > 0) ? spacing as [number, number] : null,
    rescaleSlope:ctTransformNumber(str('x00281053'),"slope"),
    rescaleIntercept:ctTransformNumber(str('x00281052'),"intercept"),
    rescaleUnit:rescaleUnit(str('x00281054')),
    transferSyntax: str('x00020010') ?? (hasPart10 ? '' : rawSyntax),
    imageRole: imageRole(str('x00080008')),
    bodyRegion: allowedRegion(str('x00180015')),
    mrSequenceCodes: scanCodes(str('x00180020')),
    repetitionTimeMs: boundedDs(str('x00180080')),
    echoTimeMs: boundedDs(str('x00180081')),
    inversionTimeMs: boundedDs(str('x00180082')),
    sliceThicknessMm: boundedDs(str('x00180050')),
    contrastAgentDeclared: Boolean(str('x00180010')),
    burnedInAnnotation: privacyFlag(str('x00280301')),
    recognizableVisualFeatures: privacyFlag(str('x00280302')),
    patientIdentityRemoved: privacyFlag(str('x00120062')),
  };
  if (!result.transferSyntax || !(result.sopInstanceUid || result.studyUid || result.seriesUid || result.modality)) {
    throw new Error('DICOM не содержит достаточных технических метаданных.');
  }
  return result;
}

const MAX_COMPLEX_HEADER_BYTES = 8 * 1024 * 1024;

export async function readDicomSeriesHeader(file: File): Promise<TechnicalDicomMetadata> {
  const header = await file.slice(0, HEADER_BYTES).arrayBuffer();
  try {
    const indexed = parseDicomSeriesHeader(header);
    if (indexed.studyUid || indexed.seriesUid || indexed.sopInstanceUid) return indexed;
    // Metadata may be incomplete because the handwritten reader reached the
    // limit before the relevant technical tags.
  } catch { /* Complex SQ or raw dataset: try the standards-aware parser. */ }

  try {
    // For small slices (~300 KB), parse the complete file. For very large
    // studies the upper bound prevents uncontrolled allocations on an 8 GB M1.
    const size = Math.min(file.size, MAX_COMPLEX_HEADER_BYTES);
    const contents = size <= HEADER_BYTES ? header : await file.slice(0, size).arrayBuffer();
    return await parseComplexDicomHeader(contents);
  } catch {
    throw new Error(file.size > MAX_COMPLEX_HEADER_BYTES
      ? 'Сложный DICOM-заголовок не разобран в пределах 8 МБ; требуется другой способ импорта.'
      : 'Не удалось разобрать структуру DICOM (возможен файл без Part 10, повреждённый заголовок или неподдерживаемая кодировка).');
  }
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
