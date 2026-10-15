/** True TCIA PleThora two-radiologist-reviewed EFFUSION masks on one public
 * study. Human-vs-human baseline ONLY, not a TotalSegmentator evaluation.
 * Original 1737-byte public artifact SHA:
 * 50718acb2a3049266443b31addb46cb8e384daca34c73966420fee8c01b12e6d
 */
export type PlethoraHumanReference={
  schema:"opus-plethora-true-physician-pleural-effusion-reference-v1";
  reference:string;publisher:"TCIA";
  publisherDoi:"10.7937/tcia.2020.6c7y-gq39";
  rights:"CC BY 3.0";
  originalPublishedZipSha256:string;
  originalExpertAMaskSha256:string;originalExpertBMaskSha256:string;
  referencePatientIdIncluded:false;
  originalShapeXYZ:[512,512,134];
  sourceWorldAffineMatchedWithinMm:0.05;
  originalNativeSpatialUnits:"mm";
  originalReviewerAMaskVoxels:63668;
  originalReviewerBMaskVoxels:54206;
  originalExpertIntersectionVoxels:52625;
  humanExpertInterreaderDice:0.89290259;
  originalReviewerAMaskVolumeMl:182.15561;
  originalReviewerBMaskVolumeMl:155.08461;
  humanExpertDiscordantSliceCount:62;
  modelInferencePerformed:false;
  expertHumanAgreementIsModelAccuracy:false;
  correspondingOriginalCtDownloaded:false;
  nativeMaskToOriginalDicomGeometryVerified:false;
  medicalUseValidated:false;
  limitations:string[];
  multipleOriginalExpertReviewPairsPresent:78;
  caseSelection:"first_alphabetically_paired_pseudonymous_case";
};
const sha=(x:unknown)=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
export function parseRealPlethoraHumanReference(raw:string,bytesSha:string):PlethoraHumanReference{
 if(raw.length!==1737||bytesSha!=="50718acb2a3049266443b31addb46cb8e384daca34c73966420fee8c01b12e6d")
  throw Error("Подлинный публичный эталон TCIA не совпал по SHA-256.");
 let v:unknown;
 try{v=JSON.parse(raw)}catch{throw Error("Ошибка исходного файла эталонной разметки.");}
 if(!v||typeof v!=="object"||Array.isArray(v))
  throw Error("Неверный тип оригинального эталона.");
 const x=v as Record<string,unknown>;
 if(x.schema!=="opus-plethora-true-physician-pleural-effusion-reference-v1"||
    x.publisher!=="TCIA"||x.publisherDoi!=="10.7937/tcia.2020.6c7y-gq39"||
    x.rights!=="CC BY 3.0"||
    !sha(x.originalPublishedZipSha256)||!sha(x.originalExpertAMaskSha256)||
    !sha(x.originalExpertBMaskSha256)||x.referencePatientIdIncluded!==false||
    !Array.isArray(x.originalShapeXYZ)||x.originalShapeXYZ.join(",")!=="512,512,134"||
    x.sourceWorldAffineMatchedWithinMm!==0.05||
    x.originalNativeSpatialUnits!=="mm"||
    x.originalReviewerAMaskVoxels!==63668||x.originalReviewerBMaskVoxels!==54206||
    x.originalExpertIntersectionVoxels!==52625||x.humanExpertInterreaderDice!==0.89290259||
    Math.abs(2*52625/(63668+54206)-x.humanExpertInterreaderDice)>1e-7||
    x.originalReviewerAMaskVolumeMl!==182.15561||
    x.originalReviewerBMaskVolumeMl!==155.08461||
    x.humanExpertDiscordantSliceCount!==62||
    x.modelInferencePerformed!==false||
    x.expertHumanAgreementIsModelAccuracy!==false||
    x.correspondingOriginalCtDownloaded!==false||
    x.nativeMaskToOriginalDicomGeometryVerified!==false||
    x.medicalUseValidated!==false||
    x.multipleOriginalExpertReviewPairsPresent!==78||
    x.caseSelection!=="first_alphabetically_paired_pseudonymous_case"||
    !Array.isArray(x.limitations)||x.limitations.length!==4||
    x.limitations.some(i=>typeof i!=="string"||i.length>500))
    throw Error("Экспертный эталон содержит неподтверждённые или противоречивые медицинские утверждения.");
 return x as PlethoraHumanReference;
}
