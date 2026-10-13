/** Manual ABC/2 approximation for a single, approximately ellipsoidal
 * intraparenchymal hemorrhage on CT head. NOT automated hemorrhage detection.
 * A and B are perpendicular maximum diameters in one axial plane; C is
 * craniocaudal hemorrhage extent. Inputs are manually verified by a clinician.
 */
export type IchDimensions={aMm:number;bMm:number;cMm:number};
export type ManualIchVolume={
  schema:"opus-manual-ich-volume/v1";
  status:"clinician-entered-unsigned-research-estimate";
  modality:"CT";
  anatomy:"brain";
  target:"single_intraparenchymal_hemorrhage";
  method:"ABC/2";
  dimensionsMm:IchDimensions;
  approximateVolumeMl:number;
  source:{
    seriesKey:string;
    sourceDicomCoordinatesVerified:false;
    measurementsReadAutomatically:false;
  };
  automatedDetection:false;
  diagnosisConfirmed:false;
  absenceOfHemorrhageEstablished:false;
  clinicianIdentityVerified:false;
  limitations:string[];
};
const finitePositive=(x:unknown,max:number,name:string)=>{
  if(typeof x!=="number"||!Number.isFinite(x)||x<=0||x>max)
    throw Error("Недостоверный ручной размер "+name+". Проверьте измерение по КТ.");
  return x;
};
export function calculateManualIchVolume(dimensions:IchDimensions,seriesKey:string):ManualIchVolume {
  if(typeof seriesKey!=="string"||!seriesKey.trim()||seriesKey.length>160||
     seriesKey.includes("\u0000"))
     throw Error("Невозможно связать измерение с выбранной серией.");
  const a=finitePositive(dimensions.aMm,300,"A");
  const b=finitePositive(dimensions.bMm,300,"B");
  const c=finitePositive(dimensions.cMm,300,"C");
  // cm^3 = (a_mm/10)*(b_mm/10)*(c_mm/10)/2 = a*b*c/2000
  const volume=a*b*c/2000;
  if(!Number.isFinite(volume))throw Error("Переполнение результата");
  return {
    schema:"opus-manual-ich-volume/v1",status:"clinician-entered-unsigned-research-estimate",
    modality:"CT",anatomy:"brain",target:"single_intraparenchymal_hemorrhage",
    method:"ABC/2",dimensionsMm:{aMm:a,bMm:b,cMm:c},
    approximateVolumeMl:volume,
    source:{seriesKey:seriesKey.trim(),sourceDicomCoordinatesVerified:false,
      measurementsReadAutomatically:false},
    automatedDetection:false,diagnosisConfirmed:false,
    absenceOfHemorrhageEstablished:false,clinicianIdentityVerified:false,
    limitations:[
      "Расчёт выполняется только по размерам, введённым вручную врачом. Алгоритм не обнаруживает кровоизлияние.",
      "ABC/2 — приближение для одиночного примерно эллипсоидного внутримозгового кровоизлияния; при неправильной форме и нескольких очагах ошибка может быть значительной.",
      "A и B должны быть взаимно перпендикулярными диаметрами в плоскости максимального поперечного сечения; C — измеренной краниокаудальной протяжённостью.",
      "Метод не предназначен для субарахноидального, внутрижелудочкового, субдурального или эпидурального кровоизлияния.",
      "Привязка измерений к исходным пикселям и DICOM LPS не автоматизирована; серии и измерения должны быть перепроверены.",
      "Это неподписанная исследовательская оценка, а не решение о лечении, хирургическом вмешательстве или прогнозе.",
    ]
  };
}
