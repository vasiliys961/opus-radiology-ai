# Opus Radiology AI — Clinical detector expansion directive

## Решение владельца от 21 октября 2026 — AUTO-FIRST, обязательно

**Основной клинический сценарий:** открыть DICOM-исследование → приложение определяет
анатомическую область, модальность и последовательность/фазу по проверяемым метаданным
→ автоматически выбирает совместимые специализированные детекторы → запускает
их в рамках доступных ресурсов → локализует результаты на исходном исследовании
→ формирует **предварительное, редактируемое врачом заключение с оговорками**.
Врач не должен вручную готовить PNG/NIfTI или разбираться в весах, SHA, Python и GPU.

**Дополнительный сценарий:** понятная вкладка «Дополнительно / Выбрать детектор»:
просмотр всех доступных моделей, статуса готовности, поддерживаемых протоколов,
ручной выбор/подключение и причины, почему модель нельзя применить. Ручной путь
не заменяет автоматический и не должен загромождать основной интерфейс.

**Инварианты:** допуск модели только по проверенному типу исследования, области,
последовательности/фазе, реальной геометрии и техническим требованиям; автоматическая
разрешённая загрузка закреплённых чекпойнтов с SHA-256 и офлайн-кешем; безопасный
локальный планировщик CPU/GPU с лимитами памяти; прозрачные источники находок,
неопределённость и возможность отмены. Не запускать несовместимые модели и не
считать отсутствие результатов отрицательным заключением. Реальные пациентские
пиксели не передавать облачному провайдеру без отдельного подтверждения
обезличивания, полномочий врача и условий передачи.

**Порядок реализации:** пока расширяем портфель реальных диагностических
инструментов, не сворачиваем работу ради переделки UI. Параллельно каждая новая
модель должна регистрировать правила автоматического маршрута; далее единый
оркестратор DICOM→протокол→модели→локализация→заключение, затем ручной экспертный
override и независимая клиническая проверка. Критерий завершения — полноценный
автоматический анализ именно открытого в viewer исследования, а не отдельного
PNG-эксперимента. Пока этот критерий **НЕ** выполнен.


**Owner directive · 2026-10-20 · Active development policy.**
This is an instruction to coding agents, not a claim that the listed diagnoses are detected reliably.
Read with [AGENTS.md](../AGENTS.md), [REQUIREMENTS.md](../REQUIREMENTS.md),
[master specification](OPUS_RADIOLOGY_MASTER_SPEC.md), and the live
[46-task detector inventory](clinical-detector-coverage.json).
The inventory is a dated snapshot; check GitHub main, PRs, Actions and original scientific sources before updating a status.

## Mission and governing decision

**Build a clinically useful portfolio of real, specialized CT/MRI pathology detectors.**
Do not spend a cycle polishing the same few synthetic contracts while major anatomical/pathological
coverage remains missing. Prefer adding a previously unserved clinically meaningful task over
comparing two models for a task already covered, unless a demonstrably poor model needs replacement.
Do not mistake anatomy segmentation, HU measurements, an LLM interpretation, published checkpoint,
green CI or a single real inference for validated disease detection.

For each proposed detector, pursue this sequence:

1. **Clinical question and image protocol** — indication; CT phase / MRI sequence; supported anatomy;
   what positive finding is detectable, what is *not* detectable.
2. **Provenance and rights** — original publisher and version; permitted code/weights/dataset licences;
   size, revision and SHA-256 of actual bytes; avoid PHI, secret leakage and unlicensed sources.
3. **Genuine pretrained executor** — use actual original weights, isolated CPU/GPU worker, explicit
   RAM/VRAM/timeout limits. Never retrain by default when usable verified weights already exist.
4. **Positive original study** — real legally usable CT/MRI containing target pathology; correct modality,
   source SHA, physical geometry and expert annotation if available. Distinguish label-free demo
   from expert-positive scoring; independently exclude training overlap when claiming holdout.
5. **Spatially verifiable result** — native-source mask, boxes or landmarks; SOP/frame/slice/voxel-to-RAS/LPS
   mapping; 3-D location and relevant sizes/volumes; original source and model digests.
6. **Independent performance** — lesion-level recall and FP/study or FROC for detection, voxel Dice
   and TP/FP/FN for segmentation, relevant AUROC/calibration for study classification;
   separate single cases from independently held-out cohorts and record failures.
7. **Physician review** — overlay and evidence on original views, editable acceptance/rejection,
   uncertainty and human signoff. Gemini/Opus may independently interpret proven findings
   *only* through privacy-authorized routes, preserving disagreements; they do not create
   missing detection evidence.

### Evidence states — never collapse these

- **NOT COVERED**: no compatible pathology detector and credible tested asset.
- **CANDIDATE**: publisher asset/model identified; license/protocol/weights not all verified.
- **ASSET VERIFIED**: actual original weight bytes and SHA checked, no claim of forward.
- **REAL INFERENCE**: original trained model ran on lawful genuine compatible study and produced source-bound output.
- **EXPERT CASE MEASURED**: same source matched to a genuine human reference; quantitative results from a real run.
- **INDEPENDENT VALIDATION**: representative held-out cases, patient-level exclusion verified,
  prespecified metrics with denominators and uncertainty; *still research only until clinical/regulatory gates*.
- **CLINICAL DEPLOYMENT**: separate validated, approved medical workflow; not implied by the earlier stages.

Use the existing JSON inventory states as their existing schema permits;
do not silently promote them to these new higher research milestones.

## Operational priority queue — work on real pathology, not just anatomy

### P0 — complete already prepared high-value genuine detectors

| Clinical target | Existing candidate/starting point | Required next acceptance evidence |
|---|---|---|
| **Brain metastases, T1CE MRI** | QTIM Brain-Mets-Seg five genuine pretrained folds | Permitted positive T1CE, author-specific actual forward, source-native lesions and expert overlap; GPU separately, no Mac overload |
| **Lung tumor, chest CT** | CLN candidate; currently resource constrained | Fix worker memory on isolated CPU/GPU, real positive original CT, actual tumor mask and expert Dice |
| **Mediastinal lymph nodes, contrast CT** | Raidionics/Bouget ONNX candidate | LyNoS positive CT with native expert nodes, Dice, lesion sensitivity and FP/study; distinguish nodes from primary mass |
| **Pulmonary embolism, CTPA** | Existing true research attempt (weak reported Dice 0.038 in planning audit) | Correct CTPA input and failure analysis; if still poor, replace detector instead of celebrating green CI |
| **Renal neoplasm, appropriate multiphase CT** | MONAI three-phase research bridge | Genuine original forward on eligible licensed scan; lesion-mask overlap, phase verification |
| **Brain WMH, FLAIR** | Author fold-0 verified; original public Singapore/85 FLAIR+WMH mask confirmed | Actual original trained forward and expert TP/FP/FN/Dice (PR #302 remains unmerged unless real action passes); distinguish WMH from MS and other pathology |
| **RSNA Knee, MRI 12 findings** | Existing DINOv2/CoAtNet/MIL studies and saved experiment artefacts | Find exact best weight file and competition score provenance **reported by owner as 0.956** (not the outdated 0.808 audit); preserve train/val split; connect inference without needless retraining; independent spatial corroboration |
| **Abdominal focal tumors** | Existing liver, pancreatic and colon models | Genuine positive held-out tumor masks; assess and replace weak models rather than accumulating UI |
| **Brain aneurysms, TOF-MRA** | Existing research candidate | Verify allowed weights and real positive forward plus lesion scores; rights remain gate |

**Do not turn P0 into a serial blocker for all newly uncovered territories.**
Work through short PRs, alternating a failed/partially completed genuine model with one new anatomical-pathological coverage gap.

### P1 — add coverage genuinely missing from Opus

**Thorax:** primary mediastinal masses, chest-wall/pleural tumors, interstitial lung disease
with named HRCT patterns (ground glass, reticulation, honeycombing, traction bronchiectasis,
emphysema *only with compatible inspiration/protocol*), thoracic skeletal lesions;
real positive nodules/masses with reference localization; valve/coronary abnormalities
only with suitable CT protocol and right-cleared detector.

**Neuroradiology:** distinct small-vessel disease (WMH, lacunes, SWI microbleeds)
vs demyelination (lesion-specific FLAIR/T1 and longitudinal registration);
brain metastatic lesions, aneurysm TOF, tumor progression and stroke.
A generic hyperintense FLAIR mask cannot label multiple sclerosis or etiology.

**Abdomen/retroperitoneum:** renal/adrenal masses, retroperitoneal lymphadenopathy,
hepatic focal lesions, pancreas, colon, pathology-specific renal stones on noncontrast CT,
steatosis and cirrhosis *signs*, gallstone candidates, bowel-wall lesions and abdominal
vascular pathology. Organ mask volumes or parenchymal HU are supportive measurements,
not pathology detectors. Non-radiopaque gallstones may be invisible on CT.

**Spine and musculoskeletal:** spinal metastases, myeloma/osteolysis, compression
fractures, spinal canal stenosis, disc lesions/herniation and actual cord compression;
pelvic/cervical spine fractures, femoral-head osteonecrosis, hip osteoarthritis.
Basic vertebral/hip morphometry is already useful but must not be counted as detection
of metastatic disease, osteonecrosis, stenosis or coxarthrosis.

**Pelvis:** prostate lesions on compatible mpMRI/bpMRI using licensed assets,
bladder and gynecologic masses only when source and model exist.

If a target has no legal real checkpoint or annotated case, put it in **NOT COVERED**
with a concrete asset/data blocker. Do not write a mock detector as a substitute.

### P2 — accelerate diagnostic utility from established anatomy

Leverage source-bound TotalSegmentator anatomy to quantify heart and vessel
morphology, aortic and pulmonary artery calibers, liver–spleen attenuation on
*noncontrast* CT, spleen and portal system, gastric/gallbladder size, lumbar
trabecular HU and hip geometry. These measurements have been partly implemented
(PR #282–294). **Extend rather than duplicate**. No EF, coronary stenosis, DXA
T-score, cirrhosis or confirmed cholelithiasis from anatomy alone.
Heart-chamber and coronary specialized models may have extra licensing requirements.

## Development protocol for every short branch

- At branch start read live `main`, `AGENTS.md`, `docs/clinical-detector-coverage.json`,
  existing script/model and latest Actions for that *specific* task.
- Pick **one** clinical outcome measurable on a genuine original study.
  Small changed file set; preserve DICOM/MPR/3D; no exploratory dependency explosion.
- Use public de-identified, rights-compatible examples. Prefer small positive expert-masked datasets.
  Store weights, studies and raw masks outside Git; archive only minimal numeric provenance.
- In CI test contracts sufficiently to prevent regression; **run real model forward separately**,
  preferably GitHub Actions or isolated private GPU/CPU. Never say CI equals Dice.
- If genuine inference fails, keep PR unmerged, document exact blocker,
  pursue a different authorized model or next coverage area. Do not retry identical failures forever.
- After all mandatory checks on current head are successful, confirm mergeability then squash-merge;
  log PR, merged SHA, observed clinical value, source licences and open limitations.
  Continue with next clinically distinct task; no repeated user prompts.
- For each completed candidate, surface original-slice localization with mask/ROI or box
  and metrics in physician review; preserve unsupported findings and false positives.

## Local privacy, hardware and LLM policy

- Mac M1 with 8 GiB must never host a pile of heavyweight resident detectors.
  Weights outside application bundle, one task selected, opt-in lazy loads,
  bounded slices/ROI/streaming, isolated external CPU/GPU as needed.
- No identifiable or unapproved patient scans in public CI/GitHub or external AI.
  Private clinical-image cloud transfer remains disabled until true authorization,
  de-identification including burned-in pixel text and retained identification risks,
  jurisdiction/provider/retention controls and exact outbound-byte approval.
- Gemini and Claude Opus/GPT are optional independent reviewers, not substitutes for
  a specialized model or expert annotations; show conflicts and input coverage.
- Never assert "no pathology" merely because a model is unsupported, unrun,
  absent, failed or returned no candidates.

## Source and maintenance

This policy is the owner's **20 October 2026 clinical coverage instruction**,
adapted from the owner's supplied *full medical-functional map*: thorax,
cardio-vascular CT, neuro, abdominal, kidney, pelvis, spine, knee and hip.
Research snapshot examples in that map (BraTS TC Dice 0.975, ISLES22 Dice 0.743,
KiTS23 cyst Dice 0.925 and a lung nodule 0.884-mm localization error)
are **single-case research figures, not cohort accuracy or verified performance here**.

Source of current project-specific implementation state:
[clinical-detector-coverage.json](clinical-detector-coverage.json) and
actual GitHub workflows / numeric artifacts; update this directive and the
inventory together when a genuinely new milestone is established.
**Main KPI = number of clinically useful, genuine, spatially localized,
independently assessed pathology tasks — not PR count or CI success.**
