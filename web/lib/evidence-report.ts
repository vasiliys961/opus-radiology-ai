/** Offline printable research report. Render explicit metadata only; never
 * embed images/raw JSON, execute imported text or certify de-identification. */
import type { EvidenceDecision, SegmentationEvidence } from "./segmentation-evidence.ts";
import { COMPARISON_REASONS, normalizeLlmMeasurements, reconcileEvidence, type LlmMeasurements } from "./evidence-reconciliation.ts";
import { normalizeEvidenceReviewHistory, type EvidenceReviewHistory } from "./evidence-review-history.ts";
import type { Point3 } from "./segmentation-mask.ts";
import { latestReviewerNotes,normalizeReviewerNote,reviewerNoteNeedsRecheck,type ReviewerNote,type EvidenceWithNote } from "./evidence-reviewer-note.ts";

export const MAX_EVIDENCE_REPORT_BYTES = 2 * 1024 * 1024;
const decisions: Record<EvidenceDecision,string> = {unreviewed:"Не проверено врачом",requires_recheck:"На перепроверку",rejected:"Отклонено локально"};
const modes = {browser:"Браузер",local:"Локальный worker","cpu-server":"CPU-сервер","gpu-server":"GPU-сервер","not-recorded":"Режим не зафиксирован"};
const scopes = {"loaded-slices":"Загруженные срезы","full-organ":"Полный орган (заявление импорта)",unknown:"Охват неизвестен"};
const relations = {target_label:"В точке целевая метка",different_label:"В точке другая метка",background:"Фон маски; патологию не исключает",not_checked:"Метка не проверена"};
const escape = (v: string | number): string => {
  if ((typeof v !== "string" && typeof v !== "number") || (typeof v === "number" && !Number.isFinite(v)) || String(v).length > 16_000)
    throw new Error("Неверное или слишком длинное поле отчёта Evidence.");
  return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
};
const number = (v: number | null) => v === null ? "Не предоставлено" : escape(Number(v.toPrecision(6)));
const point = (p: Point3) => p.map(v=>escape(v)).join("; ");
const list = (items: string[]) => `<ul>${items.map(v=>`<li>${escape(v)}</li>`).join("")}</ul>`;
const table = (headers: string[], rows: string[][]) => `<div class="table"><table><thead><tr>${headers.map(h=>`<th scope="col">${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

export function buildEvidenceReport(evidence: SegmentationEvidence, options: {
  llm?: LlmMeasurements | null; sampleMask?: (point: Point3)=>number | null; generatedAt: string;
}): string {
  if (evidence.clinicalStatus !== "unverified_research_draft" || evidence.observations.length > 256 ||
    !Number.isFinite(Date.parse(options.generatedAt)) || new Date(options.generatedAt).toISOString() !== options.generatedAt)
    throw new Error("Отчёт допускает только исследовательский черновик и корректное время формирования.");
  const rawHistory = (evidence as SegmentationEvidence & {reviewHistory?: EvidenceReviewHistory}).reviewHistory;
  const history = rawHistory ? normalizeEvidenceReviewHistory(rawHistory,evidence) : null;
  if (history) {
    const states = new Map(history.events.map(e=>[e.observationId,e.to]));
    if (evidence.observations.some(o=>o.review !== (states.get(o.observationId) ?? "unreviewed")))
      throw new Error("Текущие отметки не соответствуют истории проверки; отчёт не создан.");
  }
  const rawNote=(evidence as SegmentationEvidence & {reviewerNote?:ReviewerNote}).reviewerNote;
  if(rawNote&&!history)throw new Error("Для заметки требуется связанная история проверки.");
  const note=rawNote?normalizeReviewerNote(rawNote,evidence as EvidenceWithNote):null;
  const latestNotes=latestReviewerNotes(note??undefined);
  const reviewerText=!latestNotes.length?"<p>Заметка проверяющего не предоставлена. Клиническое мнение врача не удостоверено.</p>":
    latestNotes.map(latestNote=>{
      const target=evidence.observations.find(o=>o.observationId===latestNote.observationId);
      return `<article><h3>${target?`Метка ${escape(target.labelId)} · ${escape(target.labelName)}`:"Общая заметка к результату"}</h3>
      ${target?`<p>Наблюдение: ${escape(target.observationId)}. Точка метки · LPS, мм: ${point(target.anchorLpsMm)}. Привязка к метке маски, не к очагу патологии.</p>`:""}
      <p><strong>Неподписанный черновик; автор не удостоверен.</strong> Версия заметки ${latestNote.revision}, история проверки ${latestNote.reviewRevision}.</p>
      ${reviewerNoteNeedsRecheck({...evidence,reviewerNote:note} as EvidenceWithNote,latestNote.observationId??null)?"<p><strong>Заметку нужно перепроверить: после её сохранения изменились отметки.</strong></p>":"<p>Текст связан с текущей историей проверки; это не клиническое утверждение.</p>"}
      <p>${latestNote.text?escape(latestNote.text):"Текущая заметка очищена; прошлые версии сохранены в JSON."}</p><p>Заявленное время: ${escape(latestNote.at)} · UTC.</p></article>`;
    }).join("");
  const llm = options.llm ? normalizeLlmMeasurements(options.llm) : null;
  const comparison = llm ? reconcileEvidence(evidence,llm,options.sampleMask) : null;
  const s = evidence.source, m = evidence.producer.model;
  const identity = table(["Поле","Значение"],[
    ["Пакет",escape(s.requestId)],["Модальность / загруженные срезы",`${escape(s.modality)} / ${escape(s.frameCount)}`],
    ["Модель / версия",`${escape(m.id)} / ${escape(m.version)}`],["Заявленная задача",escape(m.task)],
    ["Исполнение",escape(modes[evidence.producer.executionMode])],
    ["SHA-256 источника",escape(s.sourceIdentitySha256)],["SHA-256 входа",escape(s.inputSha256)],
    ["SHA-256 маски",escape(evidence.mask.sha256)],["SHA-256 весов",escape(m.weightsSha256)],
    ["Сетка входа",s.geometry.dimensions.map(escape).join(" × ")],["Сетка маски",evidence.mask.geometry.dimensions.map(escape).join(" × ")],
    ["Аффинная матрица входа · LPS, мм",s.geometry.affineLps.map(escape).join("; ")],
    ["Аффинная матрица маски · LPS, мм",evidence.mask.geometry.affineLps.map(escape).join("; ")],
  ]);
  const measurements = evidence.observations.length ? table(["Метка","Воксели","Объём разметки, мл","Точка метки · LPS, мм","Проверка"],evidence.observations.map(o=>[
    `${escape(o.labelId)} · ${escape(o.labelName)}`,escape(o.voxels),number(o.volumeMl),point(o.anchorLpsMm),escape(decisions[o.review]),
  ])) : "<p>Ненулевых меток нет. Это не отрицательное диагностическое заключение.</p>";
  const hypotheses = !llm || !comparison ? "<p>Гипотезы LLM не импортированы. Анализ LLM этим отчётом не подтверждён.</p>" :
    `<p>Заявленный провайдер: ${escape(llm.producer.provider)}. Модель: ${escape(llm.producer.model)}. Происхождение, независимость и охват не удостоверены.</p>
    ${table(["Заявленный пакет / срезы","SHA источника","SHA входа"],[[`${escape(llm.source.requestId)} / ${escape(llm.source.frameCount)}`,escape(llm.source.sourceIdentitySha256),escape(llm.source.inputSha256)]])}
    ${comparison.comparisons.map((c,i)=>{
      const claim = llm.claims[i], spatial = c.spatial;
      return `<article><h3>Гипотеза ${escape(claim.claimId)}</h3><p>${escape(claim.statement)}</p>
        <p>Цель: ${escape(claim.observationId)}. SHA весов цели: ${escape(claim.modelWeightsSha256)}.</p>
        <p>Метрика: ${claim.metric === "label-volume-ml" ? "Объём метки, мл" : "Другая гипотеза — не измерение объёма метки"}. Охват: ${escape(scopes[claim.scope])}.</p>
        ${table(["Объём маски, мл","Заявление LLM, мл","Разность LLM − маска, мл"],[[number(c.specialistVolumeMl),number(c.llmVolumeMl),number(c.deltaMl)]])}
        <p><strong>${c.status === "not_comparable" ? "Нельзя сопоставить" : c.status === "numeric_match" ? "Числа совпадают" : "Числовое расхождение"} — нужна врачебная проверка.</strong></p>
        ${list(c.reasons.map(r=>COMPARISON_REASONS[r]))}
        ${!claim.anchor ? "<p>Точка LLM не предоставлена.</p>" : `<p>Заявленная точка: ${point(claim.anchor.pointLpsMm)} · LPS, мм. SHA маски точки: ${escape(claim.anchor.maskSha256)}.</p>
          <p>${spatial?.status === "not_bound" ? "Привязка точки не подтверждена" : spatial?.status === "outside_volume" ? "Точка за пределами объёма" : escape(relations[spatial!.relation])}.
          ${spatial?.sampledLabelId === null ? "" : `Метка в точке: ${number(spatial!.sampledLabelId)}.`}</p>
          ${spatial?.sourceIndex ? `<p>Непрерывный индекс в исходной сетке: ${point(spatial.sourceIndex)}.</p>` : ""}${list(spatial?.reasons ?? [])}`}
        </article>`;
    }).join("")}`;
  const journal = !history ? "<p>История проверки не предоставлена; автор решений не удостоверен.</p>" :
    `<p>Версия ${history.events.length}. Локальные/импортированные отметки; автор и время не удостоверены.</p>${history.events.length ?
      table(["Версия","Метка","Было","Стало","Заявленное время · UTC"],history.events.map(e=>[
        escape(e.revision),escape(e.observationId),escape(decisions[e.from]),escape(decisions[e.to]),escape(e.at),
      ])) : "<p>Изменений ещё нет.</p>"}`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Opus · исследовательский отчёт Evidence</title><style>
    body{font:15px/1.5 system-ui,sans-serif;color:#172d28;max-width:1000px;margin:32px auto;padding:0 24px}h1,h2{color:#145b46}h2{margin-top:30px}.draft{border:2px solid #996b12;padding:16px;background:#fff8e8}p,td,li{overflow-wrap:anywhere;white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border:1px solid #cbd9d1;padding:8px;text-align:left;vertical-align:top}th{background:#edf5ef}.table{overflow-x:auto}article{border-top:1px solid #cbd9d1;padding-top:12px}small{color:#46594e}
    @page{size:A4;margin:16mm}@media print{body{font-size:10pt;margin:0;padding:0;max-width:none}.table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}h2,h3{break-after:avoid}.draft{background:none}body:after{content:"RESEARCH · DRAFT · без подписи";position:fixed;bottom:-10mm;right:0;font-size:8pt}}
    </style></head><body><h1>Opus Radiology AI · отчёт Evidence</h1>
    <div class="draft"><strong>НЕУТВЕРЖДЁННЫЙ ИССЛЕДОВАТЕЛЬСКИЙ ЧЕРНОВИК</strong><p>Не является диагнозом или подписанным заключением. Объёмы относятся только к загруженным срезам; полнота органа не подтверждена. Сегментация не является детектором всех патологий.</p></div>
    <p>Сформировано: ${escape(options.generatedAt)} · UTC, время устройства не удостоверено.</p>
    <h2>Источник и происхождение</h2>${identity}
    <h2>Измерения по маске</h2>${measurements}
    <p>Числовые объёмы и разности показаны с точностью до 6 значащих цифр для чтения. Сопоставление выполнено по исходным значениям; точные числа сохранены в JSON Evidence. Это не заявленная клиническая точность измерения.</p>
    <h2>Гипотезы LLM и сопоставление</h2>${hypotheses}
    <p>Совпадение чисел или метки в точке не доказывает клинического согласия. Фон маски не исключает патологию. Порог клинической значимости не задан.</p>
    <h2>Локальная история проверки</h2>${journal}
    <h2>Заметка проверяющего · черновик</h2>${reviewerText}
    <h2>Ограничения результата</h2>${list(evidence.limitations)}
    <p>Контрольные суммы связывают данные, но не удостоверяют пациента, автора или клиническую точность. Клиническое мнение врача не удостоверено; подпись и клиническое утверждение не предоставлены.</p>
    <small>Отчёт храните локально. Текст, хеши и координаты не гарантируют обезличивание; разрешение на внешнюю отправку пациентов не предоставлено. Для печати или сохранения PDF используйте меню браузера «Печать».</small>
    </body></html>`;
  if (new TextEncoder().encode(html).byteLength > MAX_EVIDENCE_REPORT_BYTES) throw new Error("Отчёт превышает лимит 2 МиБ.");
  return html;
}
