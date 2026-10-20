/** Research numeric-only import; no source CT, mask, trained inference or patient data transfer. */
export type NumericReview={schema:string;title:string;sourceSha256:string;fields:{label:string;value:string}[];warnings:string[];clinicalValidation:false};
type RecordValue=Record<string,unknown>;
const obj=(x:unknown):RecordValue=>{if(!x||typeof x!=="object"||Array.isArray(x))throw Error("Некорректный исследовательский JSON.");return x as RecordValue;};
const hash=(x:unknown)=>{if(typeof x!=="string"||!/^[a-f0-9]{64}$/i.test(x))throw Error("Отсутствует корректный SHA-256 оригинального исследования.");return x.toLowerCase();};
const val=(x:unknown,lo=-1500,hi=1000000)=>{if(typeof x!=="number"||!Number.isFinite(x)||x<lo||x>hi)throw Error("Отсутствует числовая величина или она вне диапазона.");return x;};
const fmt=(x:number,unit:string)=>x.toLocaleString("ru-RU",{maximumFractionDigits:3})+(unit?" "+unit:"");
const titles:Record<string,string>={
 "opus-native-cardiovascular-CT-anatomy-measurements/v1":"Сердце и сосуды · КТ",
 "opus-vertebral-opportunistic-native-CT-HU/v1":"Позвоночник · L1–L5 HU",
 "opus-noncontrast-native-CT-liver-spleen-HU/v1":"Печень и селезёнка · КТ",
 "opus-original-wmh-source-MRI-CPU-research/v1":"FLAIR · очаги белого вещества",
 "opus-CT-gallbladder-hyperattenuation-candidate/v1":"Жёлчный пузырь · гиперденсные кандидаты",
 "opus-hip-proximal-femur-pelvis-source-mask-separation/v1":"Тазобедренный сустав · костная геометрия",
 "opus-aortic-centerline-orthogonal-anatomy-candidates/v1":"Аорта · перпендикулярные сечения КТ",
 "opus-true-original-TotalSpineSeg-disc-cord-MRI/v1":"МРТ позвоночника · диски и канал"
};
export function validateMorphometryReport(raw:unknown):NumericReview{
 const x=obj(raw);
 if(typeof x.schema!=="string"||!Object.prototype.hasOwnProperty.call(titles,x.schema))
  throw Error("Неизвестная схема исследовательских данных.");
 if(x.clinicallyValidated!==false)throw Error("Отсутствует обязательный запрет на клиническую валидность.");
 const sourceSha256=hash(x.originalSourceCTSHA256??x.sourceCTSHA256??x.originalCtSHA256??x.sourceFLAIRSHA256??x.sourceMRI_SHA256);
 const fields:{label:string;value:string}[]=[];
 let originalWMHLesionEvidenceVerified=false;
 const add=(label:string,n:unknown,unit:string,lo=-1500,hi=1000000)=>fields.push({label,value:fmt(val(n,lo,hi),unit)});
 if(x.schema==="opus-native-cardiovascular-CT-anatomy-measurements/v1"){
  const m=obj(x.measurements);const known=["heart","aorta","superior_vena_cava","inferior_vena_cava","portal_vein_and_splenic_vein","iliac_artery_left","iliac_artery_right","iliac_vena_left","iliac_vena_right"];
  for(const name of known){if(!Object.prototype.hasOwnProperty.call(m,name))continue;const v=obj(m[name]);if(v.maskEmpty===true)continue;
   add(name+" · объём маски",v.volumeMl,"мл",0,100000);
   if(v.candidateAxialDiameterMm!=null)add(name+" · площадь-эквивалентный аксиальный диаметр",v.candidateAxialDiameterMm,"мм",0,500);
  }
 }else if(x.schema==="opus-vertebral-opportunistic-native-CT-HU/v1"){
  const m=obj(x.measures);for(const name of ["L1","L2","L3","L4","L5"]){if(!Object.prototype.hasOwnProperty.call(m,name))continue;add(name+" · медиана ROI",obj(obj(m[name]).attenuationHU).median,"HU",-1200,6500);}
 }else if(x.schema==="opus-noncontrast-native-CT-liver-spleen-HU/v1"){
  add("Печень · медиана",obj(obj(x.liver).HU).median,"HU",-1200,6500);
  add("Селезёнка · медиана",obj(obj(x.spleen).HU).median,"HU",-1200,6500);
  add("Печень минус селезёнка",x.liverMinusSpleenMedianHU,"HU",-2500,2500);
 }else if(x.schema==="opus-original-wmh-source-MRI-CPU-research/v1"){
  if(x.realTrainedOriginalWMHModelForwardCompleted!==true)throw Error("Не подтверждён реальный оригинальный инференс WMH.");
  hash(x.checkpointSHA256);
  add("WMH · компоненты",x.candidateComponentCount,"",0,5000);
  add("WMH · объём кандидатов",x.totalPredictedHyperintensityMl,"мл",0,100000);
  if(x.originalExpertOverlap!=null){
   const e=obj(x.originalExpertOverlap);
   hash(e.originalExpertWMHMaskSHA256);
   if(e.sameOriginalNativeGrid!==true||e.clinicalValidation!==false||
      e.singleCaseResearchScoreNotIndependentValidation!==true||
      x.trainingOverlapIndependentlyExcluded!==false)
    throw Error("Экспертный WMH score не подтверждён как ограниченное исследовательское сравнение.");
   const count=(n:unknown)=>{const v=val(n,0,80000000);if(!Number.isInteger(v))throw Error("WMH TP/FP/FN нецелые.");return v;};
   const tp=count(e.tp),fp=count(e.fp),fn=count(e.fn),tn=count(e.tn),ignored=count(e.expertOtherPathologyLabel2ExcludedVoxels);
   if(tp+fn===0||tp+fp+fn+tn+ignored>80000000)
    throw Error("Некорректная экспертная WMH статистика.");
   const dice=2*tp/(2*tp+fp+fn),sensitivity=tp/(tp+fn),precision=tp+fp?tp/(tp+fp):0;
   for(const [reported,computed] of [[e.dice,dice],[e.sensitivity,sensitivity],[e.precision,precision]] as [unknown,number][]){
    if(Math.abs(val(reported,0,1)-computed)>0.000001)
     throw Error("WMH Dice/чувствительность/precision не совпадают с TP/FP/FN.");
   }
   add("Экспертная WMH · TP",tp,"",0,80000000);
   add("Экспертная WMH · FP",fp,"",0,80000000);
   add("Экспертная WMH · FN",fn,"",0,80000000);
   add("Экспертная WMH · Dice",dice*100,"%",0,100);
   add("Экспертная WMH · чувствительность",sensitivity*100,"%",0,100);
   add("Экспертная WMH · precision",precision*100,"%",0,100);
   add("Другие патологии · исключённые воксели",ignored,"",0,80000000);
   // Optional TRUE author fold-0 lesion analysis (newer research JSON).
   // Older genuine WMH reports without this field remain readable.
   const lesionKeys=[
    "expertLesionComponents26Connectivity",
    "predictedLesionComponents26Connectivity",
    "matchedExpertLesionsAnyVoxelOneToOne",
    "missedExpertLesions",
    "unmatchedPredictedLesionComponents",
    "lesionRecallAnyOverlap",
    "falsePositiveComponentsPerStudy"
   ] as const;
   if(lesionKeys.some(k=>e[k]!==undefined)){
    if(lesionKeys.some(k=>e[k]===undefined)||
       e.singleCaseAnyVoxelOverlapNotValidatedDetection!==true||
       e.otherPathologyLabel2ExcludedFromComponentScoring!==true||
       e.independentHoldout!==false||e.clinicalValidation!==false)
     throw Error("WMH компоненты не подтверждены как ограниченное исследовательское сопоставление.");
    const trueLesions=count(e.expertLesionComponents26Connectivity);
    const predictedLesions=count(e.predictedLesionComponents26Connectivity);
    const matched=count(e.matchedExpertLesionsAnyVoxelOneToOne);
    const missed=count(e.missedExpertLesions);
    const unmatched=count(e.unmatchedPredictedLesionComponents);
    const falseComponents=count(e.falsePositiveComponentsPerStudy);
    const lesionRecall=val(e.lesionRecallAnyOverlap,0,1);
    if(trueLesions<1||matched>Math.min(trueLesions,predictedLesions)||
       matched+missed!==trueLesions||matched+unmatched!==predictedLesions||
       unmatched!==falseComponents||
       Math.abs(lesionRecall-matched/trueLesions)>0.000001)
     throw Error("Число обнаруженных/пропущенных WMH-компонентов и recall не совпадают.");
    add("Экспертные WMH · 3D-компоненты",trueLesions,"",1,80000000);
    add("WMH · сопоставлено 3D-компонентов",matched,"",0,80000000);
    add("WMH · пропущено 3D-компонентов",missed,"",0,80000000);
    add("WMH · несопоставленные предсказанные компоненты",unmatched,"",0,80000000);
    add("WMH · recall компонентов (любое пересечение)",lesionRecall*100,"%",0,100);
    originalWMHLesionEvidenceVerified=true;
   }

  }
 }else if(x.schema==="opus-CT-gallbladder-hyperattenuation-candidate/v1"){
  if(!Array.isArray(x.candidates)||x.candidates.length>1000)throw Error("Неограниченный список кандидатов.");
  add("Гиперденсные кандидаты",x.candidates.length,"",0,1000);
  add("Порог HU",x.thresholdHU,"HU",150,350);
 }else if(x.schema==="opus-true-original-TotalSpineSeg-disc-cord-MRI/v1"){
  if(x.realTwoStagePretrainedCPUMRIForwardCompleted!==true||
     x.noMRIStenosisOrDiscHerniationDiagnosis!==true)
   throw Error("Подлинный двухэтапный инференс TotalSpineSeg не подтверждён.");
  const archives=x.publisherModelArchives;
  if(!Array.isArray(archives)||archives.length!==2)
   throw Error("Не подтверждены обе оригинальные модели TotalSpineSeg.");
  for(const archive of archives){
   const a=obj(archive);
   hash(a.authorZipSHA256);hash(a.installedFold0CheckpointSHA256);
  }
  const discs=x.discCandidates;
  if(!Array.isArray(discs)||discs.length!==6)throw Error("Неверный список поясничных дисков.");
  const expected=["T12-L1","L1-L2","L2-L3","L3-L4","L4-L5","L5-S"];
  let present=0;
  for(let i=0;i<expected.length;i++){
   const d=obj(discs[i]);
   if(d.disc!==expected[i]||d.present!==true&&d.present!==false)
    throw Error("Неподтверждённая разметка уровня позвоночного диска.");
   if(d.present===true){present++;add(expected[i]+" · объём маски",d.volumeMl,"мл",0,1000);}
  }
  add("Размечено дисков",present,"",0,6);
  add("Маска спинного мозга · воксели",x.spinalCordMaskVoxels,"",0,120000000);
  add("Маска канала · воксели",x.spinalCanalMaskVoxels,"",0,120000000);
 }else if(x.schema==="opus-aortic-centerline-orthogonal-anatomy-candidates/v1"){
  if(x.noAneurysmOrAorticDiseaseDiagnosis!==true||
     x.measurementsAreInteriorSegmentationNotExternalWallCalipers!==true||
     x.genuineModelForwardPerformedByThisScript!==false)
   throw Error("Морфометрия аорты не должна утверждать диагноз или оригинальный инференс.");
  const n=val(x.numberOfReviewedOrthogonalPlanes,5,500);
  if(!Number.isInteger(n)||!Array.isArray(x.orthogonalProfile)||x.orthogonalProfile.length!==n)
   throw Error("Не совпадает количество ортогональных плоскостей.");
  add("Поперечные сечения",n,"",5,500);
  add("Максимальный Feret анатомической маски",x.maximumSampledMaskFeretMm,"мм",0,120);
  add("Максимальный площадь-эквивалентный диаметр",x.maximumSampledMaskAreaEquivalentDiameterMm,"мм",0,120);
 }else if(x.schema==="opus-hip-proximal-femur-pelvis-source-mask-separation/v1"){
  if(x.jointSide!=="left"&&x.jointSide!=="right")throw Error("Неизвестная сторона сустава.");
  const distance=obj(x.distanceToPelvicBoneMaskMm);
  add("Костные поверхности · min",distance.min,"мм",0,200);
  add("Костные поверхности · медиана",distance.median,"мм",0,200);
 }
 if(fields.length<1||fields.length>24)throw Error("В отчёте нет допустимых ограниченных измерений.");
 return {schema:x.schema,title:titles[x.schema],sourceSha256,fields,clinicalValidation:false,warnings:[
  "Числа получены из внешнего JSON: импорт не удостоверяет подлинность исследования и модели.",
  "Нельзя трактовать эти измерения как диагноз или исключение заболевания.",
  "Требуются сопоставление с исходной КТ/МРТ и независимая врачебная проверка.",
  ...(x.schema==="opus-original-wmh-source-MRI-CPU-research/v1" && x.originalExpertOverlap!=null
   ? ["WMH Dice рассчитан для одного исходного исследования; независимость от обучения и клиническая точность НЕ доказаны.",
      "Разметка класса 2 (другая патология) исключена из подсчёта ошибок WMH."]
   : []),
  ...(originalWMHLesionEvidenceVerified ? [
   "WMH recall рассчитан по 26-связным 3D-компонентам и любому пересечению с экспертной маской, с сопоставлением один к одному. Это НЕ подтверждённая врачом чувствительность отдельных очагов.",
   "Высокая чувствительность по вокселям не означает обнаружение всех небольших WMH; этиологию (сосудистая, РС и др.) модель не классифицирует."
  ] : [])
 ]};
}
