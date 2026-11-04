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
export const NOT_DEPLOYED="ТЭЛА не ставится. Узлы лёгких, выпот, живот, белое вещество, инсульт и глиома не скачиваются: нет закачки только весов с закреплённым размером.";
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
  {id:"brain_hemorrhage",title:"Кровоизлияние на КТ головы",
    size:"161 042 978 байт",requirement:"Linux, 16 ГБ памяти, 30 ГБ свободно"},
  {id:"lung_tumor_cln",title:"Опухоль лёгкого",
    size:"каждый файл не больше 400 МБ",requirement:"Linux и от 64 ГБ памяти"},
] as const;
export function planDetectorDeploy(host:DeployHost,scope:DeployScope="basic"):{
  eligible:boolean;reason:DeployReason;installs:readonly string[];items:DeployItem[];
}{
  const heavy=Number.isFinite(host.ramBytes)&&host.ramBytes>=CLN_RAM;
  const wanted=scope==="basic"
    ? ["chest_xray_six"]
    : ["chest_xray_six","chest_nodes","lungmask_r231","brain_hemorrhage",...(heavy?["lung_tumor_cln"]:[])];
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
