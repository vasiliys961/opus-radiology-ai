/** Local full-volume handoff. Checksums bind bytes; they do not authenticate a model. */
import type { DicomSeries } from "./dicom-series.ts";
import { assertMaskMatchesSource, invertAffine, MAX_MASK_VOXELS, type LabelMask, type MaskGeometry } from "./segmentation-mask.ts";

export const MAX_RESULT_JSON_BYTES = 64 * 1024;
export type AnalysisRequest = {
  schema: "opus-analysis-request/v1";
  requestId: string;
  sourceIdentitySha256: string;
  inputSha256: string;
  geometry: MaskGeometry;
  modality: string;
  frameCount: number;
  input: { format: "NIfTI-1"; datatype: "float32"; scalarValues: "cornerstone-decoded-no-additional-normalization" };
  scope: "selected-series-only";
  sequence: "not-confirmed";
  coverage: "not-confirmed";
};
export type AnalysisPackage = { buffer: ArrayBuffer; request: AnalysisRequest };
export type SegmentationResult = {
  schema: "opus-segmentation-result/v1";
  requestId: string;
  sourceIdentitySha256: string;
  inputSha256: string;
  maskSha256: string;
  model: { id: string; version: string; weightsSha256: string; modality: string; task: string };
  labels: { id: number; name: string }[];
  limitations: string[];
};

const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Подготовка отменена.", "AbortError"); };
export async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Контрольные суммы недоступны: откройте приложение через localhost или HTTPS.");
  const digest = await crypto.subtle.digest("SHA-256",buffer);
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
const utf8 = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const uid = (value: string | null) => typeof value === "string" && value.length<=64 && /^\d+(\.\d+)+$/.test(value);

/** Identifiers stay local. The salted digest binds the complete SOP set, not filenames. */
export async function sourceIdentity(series: DicomSeries, requestId: string): Promise<string> {
  if (!series.volumeReady || series.members.length<3) throw new Error("Нужна допустимая выбранная серия для MPR.");
  const first = series.members[0].metadata;
  if (![first.studyUid,first.seriesUid,first.frameOfReferenceUid].every(uid) || !/^[A-Z0-9]{1,16}$/.test(series.modality)) throw new Error("Для пакета нужны Study, Series и FrameOfReference UID и модальность.");
  const sops = series.members.map(({metadata:m})=>{
    if (!uid(m.sopInstanceUid) || m.studyUid!==first.studyUid || m.seriesUid!==first.seriesUid || m.frameOfReferenceUid!==first.frameOfReferenceUid || m.modality!==series.modality || (m.numberOfFrames??1)!==1) throw new Error("Неполные или противоречивые идентификаторы исходной серии.");
    return m.sopInstanceUid!;
  }).sort();
  if (new Set(sops).size!==sops.length) throw new Error("Повторный SOP Instance UID в исходной серии.");
  return sha256(utf8(JSON.stringify({requestId,study:first.studyUid,series:first.seriesUid,frame:first.frameOfReferenceUid,modality:series.modality,sops})));
}

/** Shared exact NIfTI header; validates the grid before scalar reads. */
function niftiHeader(geometry: MaskGeometry, maximum:number): {header: ArrayBuffer; count: number} {
  const {dimensions,affineLps:a} = geometry;
  invertAffine(a);
  const count = dimensions.reduce((x,y)=>x*y,1);
  if (dimensions.some(n=>!Number.isSafeInteger(n)||n<1||n>32767) || !Number.isSafeInteger(count) || count>maximum) throw new Error("Экспорт ограничен 8 388 608 вокселями для Mac M1.");
  const header = new ArrayBuffer(352), view = new DataView(header);
  view.setInt32(0,348,true);view.setInt16(40,3,true);
  dimensions.forEach((n,i)=>view.setInt16(42+i*2,n,true));
  view.setInt16(70,16,true);view.setInt16(72,32,true);view.setFloat32(76,1,true);
  for (let i=0;i<3;i++) view.setFloat32(80+i*4,Math.hypot(a[i],a[4+i],a[8+i]),true);
  view.setFloat32(108,352,true);view.setFloat32(112,1,true);view.setUint8(123,2);
  view.setInt16(254,1,true); // scanner-space sform; qform remains unset
  const encoded = a.map((v,i)=>Math.fround(i<8?-v:v));
  encoded.forEach((v,i)=>view.setFloat32(280+i*4,v,true));
  // Ensure float32 header precision has not moved the physical grid.
  assertMaskMatchesSource({dimensions,affineLps:encoded.map((v,i)=>i<8?-v:v) as MaskGeometry["affineLps"]},geometry);
  new Uint8Array(header,344,4).set([110,43,49,0]);
  return {header,count};
}
export const scalarNiftiHeader=(geometry:MaskGeometry)=>niftiHeader(geometry,MAX_MASK_VOXELS);
/** Separate disk-streamed contract. Never used by full-buffer export/MPR. */
export function fullCtNiftiHeader(geometry:MaskGeometry) {
  const d=geometry.dimensions,a=geometry.affineLps;
  if(d[0]>512||d[1]>512||d[2]<3||d[2]>300||[1,2,4,6,8,9].some(i=>Math.abs(a[i])>1e-5)||
    [a[0],a[5],a[10]].some(v=>!Number.isFinite(v)||Math.abs(v)<0.1||Math.abs(v)>20))
    throw new Error("Полный поток поддерживает только осевую КТ до 512×512×300.");
  return niftiHeader(geometry,512*512*300);
}

/** Full-buffer download path; local worker uses scalarNiftiChunks instead. */
export async function writeScalarNifti(geometry: MaskGeometry, valueAt: (index: number)=>number,
  options: { signal?: AbortSignal; yieldControl?: ()=>Promise<void> } = {}): Promise<ArrayBuffer> {
  const {header,count}=scalarNiftiHeader(geometry);
  aborted(options.signal);
  const buffer=new ArrayBuffer(352+count*4), view=new DataView(buffer);
  new Uint8Array(buffer).set(new Uint8Array(header));
  const yieldControl = options.yieldControl ?? (()=>new Promise<void>(r=>setTimeout(r,0)));
  for (let start=0;start<count;start+=32768) {
    aborted(options.signal);
    const end=Math.min(count,start+32768);
    for (let i=start;i<end;i++) {
      const value=valueAt(i);
      if (!Number.isFinite(value)||!Number.isFinite(Math.fround(value))) throw new Error("Исходные скалярные значения повреждены или не помещаются в float32.");
      view.setFloat32(352+i*4,value,true);
    }
    await yieldControl();
  }
  aborted(options.signal);
  return buffer;
}

export async function prepareAnalysisPackage(series: DicomSeries, geometry: MaskGeometry,
  valueAt: (index: number)=>number, signal?: AbortSignal): Promise<AnalysisPackage> {
  const requestId=crypto.randomUUID();
  const sourceIdentitySha256=await sourceIdentity(series,requestId);
  aborted(signal);
  if (geometry.dimensions[2]!==series.members.length) throw new Error("Объём не содержит все кадры выбранной серии.");
  const buffer=await writeScalarNifti(geometry,valueAt,{signal});
  const inputSha256=await sha256(buffer);
  aborted(signal);
  return {buffer,request:{schema:"opus-analysis-request/v1",requestId,sourceIdentitySha256,inputSha256,
    geometry:{dimensions:[...geometry.dimensions],affineLps:[...geometry.affineLps]},modality:series.modality,
    frameCount:series.members.length,input:{format:"NIfTI-1",datatype:"float32",scalarValues:"cornerstone-decoded-no-additional-normalization"},
    scope:"selected-series-only",sequence:"not-confirmed",coverage:"not-confirmed"}};
}

const record = (value: unknown): Record<string,unknown> => {
  if (!value||typeof value!=="object"||Array.isArray(value)) throw new Error("Неверный паспорт результата.");
  return value as Record<string,unknown>;
};
const text = (value: unknown, maximum=160): string => {
  if (typeof value!=="string"||!value.trim()||value.length>maximum||/[\u0000-\u001f\u007f]/.test(value)) throw new Error("Неверная строка паспорта результата.");
  return value.trim();
};
const digest = (value: unknown): string => {
  if (typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value)) throw new Error("Неверная контрольная сумма SHA-256.");
  return value;
};
export function parseSegmentationResult(json: string): SegmentationResult {
  if (utf8(json).byteLength>MAX_RESULT_JSON_BYTES) throw new Error("Паспорт результата больше 64 КиБ.");
  const root=record(JSON.parse(json));
  if (root.schema!=="opus-segmentation-result/v1") throw new Error("Неподдерживаемая версия паспорта результата.");
  const model=record(root.model);
  if (!Array.isArray(root.labels)||root.labels.length>256 || !Array.isArray(root.limitations)||root.limitations.length>20) throw new Error("Неверный словарь меток или ограничений модели.");
  const ids=new Set<number>();
  const labels=root.labels.map(value=>{
    const l=record(value);
    if (typeof l.id!=="number"||!Number.isInteger(l.id)||l.id<1||l.id>65535||ids.has(l.id)) throw new Error("Повторная или неверная метка результата.");
    ids.add(l.id);return {id:l.id,name:text(l.name)};
  });
  const requestId=text(root.requestId,36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)) throw new Error("Неверный ID запроса.");
  return {schema:"opus-segmentation-result/v1",requestId,sourceIdentitySha256:digest(root.sourceIdentitySha256),
    inputSha256:digest(root.inputSha256),maskSha256:digest(root.maskSha256),
    model:{id:text(model.id),version:text(model.version),weightsSha256:digest(model.weightsSha256),modality:text(model.modality,16),task:text(model.task)},
    labels,limitations:root.limitations.map(value=>text(value,500))};
}

export function assertResultBinding(result: SegmentationResult, request: AnalysisRequest, mask: LabelMask, maskSha256: string): void {
  if (result.requestId!==request.requestId || result.sourceIdentitySha256!==request.sourceIdentitySha256 || result.inputSha256!==request.inputSha256) throw new Error("Результат относится к другому пакету или исходной серии.");
  if (result.maskSha256!==maskSha256) throw new Error("Контрольная сумма маски не совпадает с паспортом результата.");
  if (result.model.modality!==request.modality) throw new Error("Модальность модели не совпадает с исходной серией.");
  const ids=new Set(result.labels.map(l=>l.id));
  if (mask.labels.some(l=>!ids.has(l.id))) throw new Error("В маске есть метки, отсутствующие в словаре модели.");
  assertMaskMatchesSource(mask,request.geometry);
}
