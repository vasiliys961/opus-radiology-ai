/** Whether this machine may download pinned detector weights.
 * The Mac workstation is never eligible. No download happens in this module.
 */
export const DETECTOR_DEPLOY_MINIMUM={
  operatingSystem:"Linux",
  ramGib:16,
  freeDiskGib:30,
} as const;
const RAM=DETECTOR_DEPLOY_MINIMUM.ramGib*1024**3;
const DISK=DETECTOR_DEPLOY_MINIMUM.freeDiskGib*1024**3;
const CLN_RAM=64*1024**3;
export const NOT_DEPLOYED="Инсульт и глиома не скачиваются: нет закреплённого адреса и контрольной суммы этих файлов. Кровоизлияние считает только заранее разрешённое публичное исследование. Рентген грудной клетки к стопке КТ не применяется. ТЭЛА — некоммерческие веса; кандидат не исключает эмболию.";
export type DeployHost={platform:string;ramBytes:number;freeDiskBytes:number};
export type DeployReason="ok"|"mac"|"os"|"ram"|"disk";
export type DeployScope="basic"|"full";
export type DeployItem={
  id:string;title:string;size:string;requirement:string;willInstall:boolean;
};
export const BASIC_CATALOG=[
  {id:"chest_xray_six",title:"Рентген грудной клетки, шесть признаков",
    size:"от 10 до 90 МБ",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно"},
] as const;
export const FULL_CATALOG=[
  ...BASIC_CATALOG,
  {id:"chest_nodes",title:"Лимфоузлы средостения",
    size:"архив 105 186 900 байт",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно"},
  {id:"lungmask_r231",title:"Окраска лёгких",
    size:"не больше 150 МБ",requirement:"Linux, 16 ГБ памяти. Узлы и опухоли не ищет"},
  {id:"lung_nodules",title:"Узлы лёгких",
    size:"вес 83 709 381 байт",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно. Кандидаты, не диагноз"},
  {id:"brain_hemorrhage",title:"Кровоизлияние на КТ головы",
    size:"161 042 978 байт",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно"},
  {id:"chest_effusion",title:"Выпот плевры и перикарда",
    size:"архив 233 744 954 байт",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно. Нулевой объём не исключает выпот"},
  {id:"abdomen_ct",title:"Живот: кисты почек и очаги печени",
    size:"архивы 230 592 397 и 230 940 114 байт",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно. Не диагноз рака"},
  {id:"brain_wmh",title:"Белое вещество на FLAIR",
    size:"вес 246 100 637 байт",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно. Не различает причину очагов"},
  {id:"chest_pe",title:"ТЭЛА",
    size:"вес 566 265 379 байт",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно. Некоммерческие веса, кандидат не исключает ТЭЛА"},
  {id:"lung_tumor_cln",title:"Опухоль лёгкого",
    size:"каждый файл не больше 400 МБ",requirement:"Linux и от 64 ГБ памяти"},
] as const;
export function planDetectorDeploy(host:DeployHost,scope:DeployScope="basic"):{
  eligible:boolean;reason:DeployReason;installs:readonly string[];items:DeployItem[];
}{
  const heavy=Number.isFinite(host.ramBytes)&&host.ramBytes>=CLN_RAM;
  const wanted=scope==="basic"
    ? ["chest_xray_six"]
    : ["chest_xray_six","chest_nodes","lungmask_r231","lung_nodules","brain_hemorrhage",
      "chest_effusion","abdomen_ct","brain_wmh","chest_pe",...(heavy?["lung_tumor_cln"]:[])];
  let reason:DeployReason="ok";
  if(host.platform==="darwin")reason="mac";
  else if(host.platform!=="linux")reason="os";
  else if(!Number.isFinite(host.ramBytes)||host.ramBytes<RAM)reason="ram";
  else if(!Number.isFinite(host.freeDiskBytes)||host.freeDiskBytes<DISK)reason="disk";
  const installs=reason==="ok"?wanted:[];
  const source=scope==="basic"?BASIC_CATALOG:FULL_CATALOG;
  return {eligible:reason==="ok",reason,installs,items:source.map(item=>({
    ...item,willInstall:installs.includes(item.id),
  }))};
}
