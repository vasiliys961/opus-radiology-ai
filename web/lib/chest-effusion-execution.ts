/** Validated handshake between the separate real task315 executable
 * and the existing source-grid effusion research viewer.
 * A mask alone never proves live inference or medical accuracy.
 */
import {parseEffusionResearchReport,type EffusionResearchReport} from "./chest-effusion-research.ts";
export type ImportedTask315={
 evidence:EffusionResearchReport;
 execution:"source-mask-only"|"reported-pretrained-execution";
 packageVersion:string|null;
 activeWeightsProven:false;
};
const obj=(x:unknown)=>{
 if(!x||typeof x!=="object"||Array.isArray(x))throw Error("Неверный формат отчёта task315.");
 return x as Record<string,unknown>;
};
const hash=(x:unknown)=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
export function parseImportedTask315(raw:string):ImportedTask315{
 if(raw.length<64||raw.length>512*1024)throw Error("Исследовательский отчёт слишком большой.");
 const v=obj(JSON.parse(raw));
 if(v.schema==="opus-real-totalseg-ct-effusion-source-proposals/v1")
   return {evidence:parseEffusionResearchReport(raw),
      execution:"source-mask-only",packageVersion:null,activeWeightsProven:false};
 if(v.schema!=="opus-real-task315-effusion-execution/v1"||
    v.task!=="pleural_pericard_effusion"||
    v.runMode!=="isolated-author-installed"||
    v.actualPretrainedInferenceClaimed!==true||
    v.requestedDevice!=="cpu"||
    v.modelPackageVersion!=="2.18.0"||
    v.activeWeightsCryptographicallyProven!==false||
    v.clinicalStatus!=="unverified_research_draft"||
    v.negativeDiagnosisPermitted!==false||
    !hash(v.sourceNiftiSha256)||!hash(v.maskSha256)||
    !hash(v.observedInstalledWeightFileSha256)||
    !Array.isArray(v.sourceDimensions)||v.sourceDimensions.length!==3)
    throw Error("Не подтверждён контракт реального task315.");
 const evidence=parseEffusionResearchReport(JSON.stringify(obj(v.evidence)));
 if(v.sourceNiftiSha256!==evidence.originalChestCtSha256||
    v.maskSha256!==evidence.modelOutputNativeMaskSha256||
    v.observedInstalledWeightFileSha256!==evidence.modelCheckpointSha256ObservedNotSignedPublisherProof||
    v.sourceDimensions.join(",")!==evidence.originalCTDimensionsXYZ.join(","))
    throw Error("Исходная КТ, маска или веса не совпадают с task315 Evidence.");
 return {evidence,execution:"reported-pretrained-execution",
   packageVersion:"2.18.0",activeWeightsProven:false};
}
