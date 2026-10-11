/** Bound specialist measurements, separate from LLM hypotheses and diagnoses.
 * Metadata only: never retains/copies the mask or decoded DICOM volume.
 */
import { assertResultBinding, parseSegmentationResult, type AnalysisRequest, type SegmentationResult } from "./analysis-package.ts";
import { MAX_MASK_VOXELS, transformPoint, type LabelMask, type MaskGeometry, type Point3 } from "./segmentation-mask.ts";

export type ExecutionMode = "browser" | "local" | "cpu-server" | "gpu-server" | "not-recorded";
export type EvidenceDecision = "unreviewed" | "requires_recheck" | "rejected";
export type SegmentationObservation = {
  observationId: string;
  kind: "segmentation-measurement";
  labelId: number;
  labelName: string;
  voxels: number;
  volumeMl: number;
  boundsMaskIndex: { min: Point3; max: Point3 };
  anchorLpsMm: Point3;
  review: EvidenceDecision;
};
export type SegmentationEvidence = {
  schema: "opus-specialist-evidence/v1";
  clinicalStatus: "unverified_research_draft";
  producer: { kind: "specialist-model"; executionMode: ExecutionMode; model: SegmentationResult["model"] };
  source: Pick<AnalysisRequest, "requestId" | "sourceIdentitySha256" | "inputSha256" | "frameCount" | "modality" | "scope" | "coverage"> & { geometry: MaskGeometry };
  mask: { sha256: string; geometry: MaskGeometry };
  observations: SegmentationObservation[];
  limitations: string[];
};

const geometryCopy = (g: MaskGeometry): MaskGeometry => ({dimensions:[...g.dimensions],affineLps:[...g.affineLps]});

/** Caller supplies the digest of the actual mask file, never just its passport.
 * One pass, O(labels) state, periodic yields and cancellation on the main thread.
 * Anchor is an occupied voxel closest to the grid centre, not a lesion/centroid.
 */
export async function buildSegmentationEvidence(request: AnalysisRequest, result: SegmentationResult,
  mask: LabelMask, maskSha256: string, options: { executionMode?: ExecutionMode; signal?: AbortSignal; yieldControl?: ()=>Promise<void> } = {}): Promise<SegmentationEvidence> {
  const abort = () => {if(options.signal?.aborted)throw new DOMException("Подготовка Evidence отменена.","AbortError");};
  abort();
  const parsed = parseSegmentationResult(JSON.stringify(result));
  assertResultBinding(parsed,request,mask,maskSha256);
  const [nx,ny,nz]=mask.dimensions, count=nx*ny*nz;
  if (!mask.dimensions.every(n=>Number.isSafeInteger(n)&&n>0) || !Number.isSafeInteger(count) || count>MAX_MASK_VOXELS
    || mask.data.length!==count || request.frameCount!==request.geometry.dimensions[2]) throw new Error("Неверный размер маски для Evidence.");
  const mode=options.executionMode??"not-recorded";
  if(!["browser","local","cpu-server","gpu-server","not-recorded"].includes(mode))throw new Error("Неизвестный режим Evidence.");
  const a=mask.affineLps;
  const voxelMl=Math.abs(a[0]*(a[5]*a[10]-a[6]*a[9])-a[1]*(a[4]*a[10]-a[6]*a[8])+a[2]*(a[4]*a[9]-a[5]*a[8]))/1000;
  const states=new Map(parsed.labels.map(l=>[l.id,{name:l.name,voxels:0,min:[nx,ny,nz] as Point3,max:[-1,-1,-1] as Point3,anchor:[0,0,0] as Point3,distance:Infinity}]));
  const centre=[(nx-1)/2,(ny-1)/2,(nz-1)/2];
  const yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  for(let start=0;start<count;start+=32768) {
    abort();
    for(let i=start;i<Math.min(count,start+32768);i++) {
      const label=mask.data[i];if(!label)continue;
      const state=states.get(label);
      if(!state)throw new Error("В маске есть метка вне словаря Evidence.");
      const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));
      state.voxels++;
      state.min[0]=Math.min(state.min[0],x);state.min[1]=Math.min(state.min[1],y);state.min[2]=Math.min(state.min[2],z);
      state.max[0]=Math.max(state.max[0],x);state.max[1]=Math.max(state.max[1],y);state.max[2]=Math.max(state.max[2],z);
      const distance=(x-centre[0])**2+(y-centre[1])**2+(z-centre[2])**2;
      if(distance<state.distance){state.distance=distance;state.anchor=[x,y,z];}
    }
    await yieldControl();
  }
  abort();
  const observations: SegmentationObservation[]=[];
  for(const [id,state] of states)if(state.voxels)observations.push({observationId:`${parsed.requestId}:label:${id}`,
    kind:"segmentation-measurement",labelId:id,labelName:state.name,voxels:state.voxels,volumeMl:state.voxels*voxelMl,
    boundsMaskIndex:{min:state.min,max:state.max},anchorLpsMm:transformPoint(a,state.anchor),review:"unreviewed"});
  return {schema:"opus-specialist-evidence/v1",clinicalStatus:"unverified_research_draft",
    producer:{kind:"specialist-model",executionMode:mode,model:{...parsed.model}},
    source:{requestId:request.requestId,sourceIdentitySha256:request.sourceIdentitySha256,inputSha256:request.inputSha256,
      frameCount:request.frameCount,modality:request.modality,scope:request.scope,coverage:request.coverage,geometry:geometryCopy(request.geometry)},
    mask:{sha256:maskSha256,geometry:geometryCopy(mask)},observations,
    limitations:["Объёмы разметки относятся только к загруженным срезам; полнота органа не подтверждена.",
      "Сегментация не является детекцией патологии или отрицательным диагностическим заключением.",
      "Контрольные суммы связывают данные, но не удостоверяют автора, пациента или клиническую точность.",
      "Врачебные отметки локальные, без электронной подписи и клинического утверждения.",...parsed.limitations]};
}

/** Immutable local review; cannot promote a result to verified/signed. */
export function reviewSegmentationEvidence(evidence: SegmentationEvidence, observationId: string, decision: EvidenceDecision): SegmentationEvidence {
  if(!["unreviewed","requires_recheck","rejected"].includes(decision) || !evidence.observations.some(o=>o.observationId===observationId))throw new Error("Неверная отметка Evidence.");
  return {...evidence,observations:evidence.observations.map(o=>o.observationId===observationId?{...o,review:decision}:o)};
}
