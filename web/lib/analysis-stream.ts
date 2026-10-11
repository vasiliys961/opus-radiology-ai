/** Two scalar passes, bounded buffers. Acknowledged chunks provide backpressure on Safari too. */
import { sha256 as incrementalSha256 } from "@noble/hashes/sha2.js";
import { scalarNiftiHeader, sourceIdentity, type AnalysisRequest } from "./analysis-package.ts";
import type { DicomSeries } from "./dicom-series.ts";
import type { MaskGeometry } from "./segmentation-mask.ts";

export const SCALAR_CHUNK_VOXELS = 32768;
export type AnalysisStream = {
  request: AnalysisRequest;
  byteLength: number;
  chunks: (signal: AbortSignal) => AsyncIterable<ArrayBuffer>;
};
const abort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Подготовка отменена.", "AbortError"); };

export async function* scalarNiftiChunks(geometry: MaskGeometry, valueAt: (index: number)=>number,
  signal: AbortSignal, yieldControl = ()=>new Promise<void>(r=>setTimeout(r,0))): AsyncGenerator<ArrayBuffer> {
  const {header,count}=scalarNiftiHeader(geometry);
  abort(signal);
  yield header;
  for(let start=0;start<count;start+=SCALAR_CHUNK_VOXELS) {
    abort(signal);
    const end=Math.min(count,start+SCALAR_CHUNK_VOXELS);
    const buffer=new ArrayBuffer((end-start)*4), view=new DataView(buffer);
    for(let i=start;i<end;i++) {
      const value=valueAt(i);
      if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value))) throw new Error("Исходные скалярные значения повреждены или не помещаются в float32.");
      view.setFloat32((i-start)*4,value,true);
    }
    yield buffer; // Producer resumes only after the consumer acknowledges this block.
    await yieldControl();
  }
  abort(signal);
}

export async function prepareAnalysisStream(series: DicomSeries, geometry: MaskGeometry,
  valueAt: (index: number)=>number, signal: AbortSignal): Promise<AnalysisStream> {
  // Snapshot the physical grid: mutations during either pass cannot change the header.
  const grid: MaskGeometry={dimensions:[...geometry.dimensions],affineLps:[...geometry.affineLps]};
  const {count}=scalarNiftiHeader(grid);
  if(grid.dimensions[2]!==series.members.length) throw new Error("Объём не содержит все кадры выбранной серии.");
  const requestId=crypto.randomUUID(), identity=await sourceIdentity(series,requestId);
  const hash=incrementalSha256.create();
  let inputSha256: string;
  try {
    for await(const chunk of scalarNiftiChunks(grid,valueAt,signal)) hash.update(new Uint8Array(chunk));
    inputSha256=Array.from(hash.digest(),v=>v.toString(16).padStart(2,"0")).join("");
  } finally {hash.destroy();}
  abort(signal);
  return {byteLength:352+count*4,chunks:nextSignal=>scalarNiftiChunks(grid,valueAt,nextSignal),
    request:{schema:"opus-analysis-request/v1",requestId,sourceIdentitySha256:identity,inputSha256,
      geometry:grid,modality:series.modality,frameCount:series.members.length,
      input:{format:"NIfTI-1",datatype:"float32",scalarValues:"cornerstone-decoded-no-additional-normalization"},
      scope:"selected-series-only",sequence:"not-confirmed",coverage:"not-confirmed"}};
}
