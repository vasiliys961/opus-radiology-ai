/** Offline printable research summary: no patient images or remote code. */
import type {PathologyReviewDraft,PathologyFinding} from "./pathology-findings.ts";

function escapeHtml(v:string):string {
  return v.replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  } as Record<string,string>)[c]);
}
function txt(v:unknown,max=4000):string {
  if(typeof v!=="string"||v.length>max||v.includes("\u0000"))throw Error("Некорректный текст отчёта");
  return escapeHtml(v);
}
function n(v:number,d=2):string {
  if(typeof v!=="number"||!Number.isFinite(v))throw Error("Некорректное число в отчёте");
  return v.toFixed(d);
}
function sha(v:string):string {
  if(!/^[0-9a-f]{64}$/.test(v))throw Error("Отсутствует SHA-256 исходных данных");
  return txt(v);
}
const status={
  unreviewed:"Не оценён",
  needs_image_review:"Нуждается в проверке по исходным срезам",
  rejected_by_reviewer:"Отклонён локальным рецензентом"
} as const;
function findingHtml(f:PathologyFinding):string {
  const a=f.assessment;
  if(!Object.hasOwn(status,a.decision))throw Error("Неподдерживаемый статус");
  if(a.reviewerMeasuredDiameterMm!==null &&
    (typeof a.reviewerMeasuredDiameterMm!=="number"||
     !Number.isFinite(a.reviewerMeasuredDiameterMm)||
     a.reviewerMeasuredDiameterMm<=0||a.reviewerMeasuredDiameterMm>300))
     throw Error("Некорректное ручное измерение");
  return [
    '<section class="finding"><h3>Кандидат ',String(f.candidateIndex+1),'</h3>',
    '<div class="label">Предложение модели, не подтверждено</div>',
    '<p>КТ · лёгочный узел · score ',n(f.model.rawUncalibratedScore,4),
    ' (некалиброванная оценка, не вероятность болезни).</p>',
    '<p>Модельный бокс: ',f.localization.modelBoundingBoxMm.map(x=>n(x)).join(' × '),' мм.',
    ' MONAI world: ',f.localization.modelWorldCenterMm.map(x=>n(x)).join('; '),
    ' мм. DICOM/SOP привязка не проверена.</p>',
    '<div class="label">Решение локального рецензента (личность не удостоверена)</div>',
    '<p><strong>',status[a.decision],'</strong>. Ручной диаметр: ',
    a.reviewerMeasuredDiameterMm===null?'не указан':n(a.reviewerMeasuredDiameterMm,1)+' мм',
    ' (не проверен автоматически).</p>',
    '<p>Комментарий: ',a.note?txt(a.note,1500):'не добавлен','.</p>',
    '<p class="muted">Идентификатор кандидата: ',txt(f.findingId,180),'</p></section>'
  ].join('');
}
export function buildPathologyResearchHtml(draft:PathologyReviewDraft,generatedAt:string):string {
  if(!draft||draft.schema!=="opus-pathology-physician-research-draft/v1"||
   draft.status!=="unsigned_research_draft"||
   draft.sourceScope!=="public_luna16_reference_only"||
   draft.coverage.modelCoordinatesToOriginalDicomVerified!==false||
   draft.coverage.assessedAllPathologies!==false||
   draft.automatedDiagnosis!==false||draft.clinicallyValidated!==false||
   draft.absenceOfDiseaseEstablished!==false||draft.externalTransmission!==false||
   !Array.isArray(draft.findings)||draft.findings.length>300||
   !Array.isArray(draft.events)||draft.events.length>512)
   throw Error("Неверный исследовательский документ");
  if(typeof generatedAt!=="string"||!Number.isFinite(Date.parse(generatedAt))||
     new Date(generatedAt).toISOString()!==generatedAt)
     throw Error("Некорректное время");
  const b=draft.caseBinding;
  const seen=new Set<string>();
  const findings=draft.findings.map(f=>{
    if(seen.has(f.findingId)||!Number.isSafeInteger(f.candidateIndex)||f.candidateIndex<0||
       f.source.publicStudyIdentitySha256!==b.publicStudyIdentitySha256||
       f.source.sourceHeaderSha256!==b.sourceHeaderSha256||
       f.source.sourcePixelsSha256!==b.sourcePixelsSha256||
       f.source.sourceBinding!=="public_metaimage_only_not_dicom_verified"||
       f.source.seriesInstanceUid!==null||f.source.sopInstanceUid!==null||
       f.source.sourceSliceIndex!==null||
       f.localization.coordinateFrame!=="monai_world_unverified"||
       f.localization.verifiedDicomLpsMm!==null||
       f.localization.verifiedSourceVoxel!==null||
       f.model.id!==b.modelId||f.model.version!==b.modelVersion||
       f.model.weightsSha256!==b.weightsSha256)
       throw Error("Несовпадение модели, источника или геометрии");
    seen.add(f.findingId);
    return findingHtml(f);
  }).join('');
  const history=draft.events.map((e,i)=>{
    if(e.revision!==i+1||typeof e.at!=="string"||
      !Number.isFinite(Date.parse(e.at))||new Date(e.at).toISOString()!==e.at)
      throw Error("Недостоверный журнал");
    return '<tr><td>'+e.revision+'</td><td>'+txt(e.findingId,180)+
      '</td><td>'+txt(e.at,32)+'</td><td>'+txt(e.previous.decision,30)+
      '</td><td>'+txt(e.next.decision,30)+'</td></tr>';
  }).join('');
  const reviewed=draft.findings.filter(f=>f.assessment.decision!=="unreviewed").length;
  return [
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;none&apos;; connect-src &apos;none&apos;; img-src &apos;none&apos;; frame-src &apos;none&apos;; form-action &apos;none&apos;; style-src &apos;unsafe-inline&apos;; base-uri &apos;none&apos;">',
    '<title>Opus Radiology AI — исследовательский отчёт</title>',
    '<style>body{font:15px/1.5 system-ui,Arial,sans-serif;color:#19332c;max-width:840px;margin:30px auto;padding:0 20px}',
    'h1{font-size:25px}h2{font-size:18px;margin-top:24px}',
    '.label{font-size:12px;font-weight:700;color:#426359;text-transform:uppercase}',
    '.muted{font-size:12px;color:#52665e}.finding{border:1px solid #b4cfc4;border-radius:8px;padding:12px;margin:12px 0;break-inside:avoid}',
    '.caution{border-left:4px solid #ac7434;padding:12px;background:#fbf1e7}',
    'dl dd{margin:0 0 9px;overflow-wrap:anywhere}dl dt{font-weight:700}',
    'table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #bfd0c6;padding:6px;text-align:left}',
    '@media print{body{max-width:none;margin:0}.finding{break-inside:avoid}}</style></head><body>',
    '<h1>Opus Radiology AI</h1><p class="muted">Врачебный исследовательский черновик · ',txt(generatedAt,32),'</p>',
    '<div class="caution"><strong>НЕУТВЕРЖДЁННЫЙ ДОКУМЕНТ — НЕ ДИАГНОЗ.</strong> Только публичное исследование LUNA16.',
    ' Геометрия MONAI→DICOM и SOP UID не верифицированы. Личность рецензента не подтверждена.',
    ' Отсутствие кандидатов не означает отсутствие заболевания.</div>',
    '<h2>Происхождение</h2><dl><dt>Идентификатор публичного исследования SHA-256</dt><dd>',sha(b.publicStudyIdentitySha256),'</dd>',
    '<dt>Исходный .mhd SHA-256</dt><dd>',sha(b.sourceHeaderSha256),'</dd>',
    '<dt>Исходные пиксели SHA-256</dt><dd>',sha(b.sourcePixelsSha256),'</dd>',
    '<dt>Модель</dt><dd>',txt(b.modelId,160),' · ',txt(b.modelVersion,80),'</dd>',
    '<dt>Веса SHA-256</dt><dd>',sha(b.weightsSha256),'</dd>',
    '<dt>Покрытие</dt><dd>Полная публичная КТ, только задача лёгочных узлов. Другие патологии не оценивались.</dd></dl>',
    '<h2>Кандидаты и врачебная проверка</h2><p>Предложений модели: ',String(draft.findings.length),
    '; локально оценено: ',String(reviewed),'. Подтверждённых диагнозов нет.</p>',
    findings||'<p>Кандидатов нет. Это НЕ отрицательное диагностическое заключение.</p>',
    '<h2>Комментарий рецензента</h2><p>',draft.physicianSynthesis?txt(draft.physicianSynthesis,4000):'Не добавлен','</p>',
    '<h2>Локальная история решений</h2>',
    history?'<table><thead><tr><th>Версия</th><th>Находка</th><th>Время (не удостоверено)</th><th>Было</th><th>Стало</th></tr></thead><tbody>'+history+'</tbody></table>':
      '<p>Нет записей об изменениях.</p>',
    '<h2>Ограничения</h2><ul>',draft.limitations.map(x=>'<li>'+txt(x,1000)+'</li>').join(''),'</ul>',
    '<p class="muted">Локальный HTML без изображений, скриптов, сетевых запросов и электронной подписи.</p>',
    '</body></html>'
  ].join('');
}
