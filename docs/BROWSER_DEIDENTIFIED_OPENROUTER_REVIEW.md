# Opus · browser CT/MR local de-identification + two-model OpenRouter pilot

## Now executable; CPU/browser only, no GPU

The existing **VisionFramePlanningPanel** locally selects a bounded number (up to four) of geometrically validated DICOM slices and rasterizes each in the browser. **VisionPrivacyPreparation** already strips PNG metadata, validates format/dimensions/CRC, permits irreversible in-pixel black redaction rectangles, has on-device RU+EN OCR and human image/face checks tied to the exact outgoing raster SHA256. The **new** DeidentifiedOpenRouterPanel is mounted in that original workflow; it requires completed local OCR on **each** exact frame and no unresolved text, both human checks, an intact local privacy-action journal and operator/legal/cost approvals before enabling the send button.

The new **/api/ai/deidentified-openrouter-review** is a very narrow locally reachable HTTP route: enabled only on \`localhost\`/127.0.0.1 in Next's development mode, strict same-origin POST, 2.35MB total request, <=4 frames, <=2,000,000 total base64 characters, no full DICOM/masks/filenames/study UIDs, no clinical free text, no arbitrary provider IDs. It requires a separately configured local operator secret and the server operator's affirmative declaration that OpenRouter/provider data terms and patient study lawful basis are approved. It re-hashes every outgoing PNG, verifies the exact pixel + visual human review SHA for each frame, checks dimensions/PNG critical chunks/CRC and discards unexpected packet fields. Only the clean raster base64 + **ephemeral frame-1..frame-4 IDs** and CT/MR modality go to OpenRouter.

Calls run independently and in parallel with fixed model IDs, no silent provider/model downgrade:

- Gemini Vision: \`google/gemini-3.8-flash\`
- Claude Opus Vision: \`anthropic/claude-opus-5.5\`

Exactly **two paid calls per successful attempt**, no automatic retries, no patient context or other tool execution. The strict response contract requires model observations anchored to supplied ephemeral frame IDs. Two separately attributed research drafts remain visible. No vote-based diagnosis, full-study normality or sensitivity claims. Output includes local reviewed PNG SHA references but not underlying DICOM UIDs; original DICOM stays in browser.

## Explicit opt-in configuration

Local developer/operator must intentionally configure all four, keeping secrets **server-side** in ignored \`web/.env.local\` and never committing keys or giving them to the browser:

\`\`\`bash
OPENROUTER_API_KEY=<existing-real-provider-key>
RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT=1
RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED=1
RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN=<new-random-private-token-at-least-24-characters>
\`\`\`

The operator token is typed into the browser on each pilot run and verified in constant time against the private local server secret. **This is a local access control, not a verified physician identity or hospital IAM account.** The server approval flag is an operator declaration, **not** a legal or independently verified data-processing agreement. Both must be set only where the actual clinician/data-controller has confirmed a lawful basis for transferring sensitive images to OpenRouter and its downstream model providers, permitted retention and cross-border processing. If that has **not** been verified, leave the route off and use the existing LOCAL LM Studio flow or only public/synthetic studies.

### Physician workflow

1. Open Opus on localhost → DICOM → **Gemini Orchestra · подготовка кадров** → select 2–4 source frames → **Сформировать план**. At least a subset is sampled; a negative finding on sampled frames never clears the whole CT/MR.
2. **Подготовить копии без метаданных**. Inspect 1:1 **each** image, run local OCR on every one, black out name, time/date of birth, patient numbers, clinic labels, recognizable faces or other identifying text. Re-run OCR and repeat BOTH human review checks after any modification.
3. In the new panel supply local operator token, verify per-study clinical authority/legal basis, approved OpenRouter health-data handling, final visual privacy, and paid two-call acknowledgement.
4. Click **Отправить проверенные кадры Gemini + Opus**. Both models receive only the cleaned raster image data, not original DICOM. Independently review displayed findings against locally loaded DICOM.

## Boundaries, not hidden exceptions

- This is an **opt-in localhost research pilot**, not the general deployed clinical cloud API. \`PATIENT_CLOUD_TRANSMISSION_RELEASED=false\` and the old \`/api/ai/route.ts\` unsafe upload prohibition remain intact.
- **Patient images remain sensitive medical data even after names/metadata are removed.** OCR can miss image text; faces, teeth, unusual implants or rare identifiable pathologies may remain. Manual inspection and local token cannot certify true anonymization, physician credentials, institutional legal approval or processing terms. If any doubt, do not transmit.
- **Do not** enable health-data approval for a standard OpenRouter account unless the specific provider and downstream model terms actually permit these data. Existing OpenRouter keys are not evidence that patient health-data transfer is authorized. Workstation traffic is local to Next, but **OpenRouter receives outbound PNGs** once enabled.
- No source volume or full slice stack is assessed, no numeric mask-matched lesion localization is created, and **no direct live CPU pathology model runs** are triggered here. The prior public detector review is separate; connecting actual patient-matched CPU detections to the same source study is future work.
- Models can miss visible lesions and fabricate findings. No decision support claim until independently expert-validated with clinically appropriate governance.
- This route has no production-level clinician SSO/RBAC, independent de-identification service, identity attestation, centralized secure audit/retention or provider contract enforcement. Do not market or deploy it as a patient-care system. A production service must implement these controls before broad patient access.
- A single cached provider API key is used server-side. No extra GPU, no model download and no DICOM uploads are required.

## Technical acceptance

\`web/lib/sanitized-cloud-review.test.ts\` stubs exactly two OpenRouter calls and checks no DICOM IDs, source UIDs, patient fields, packet UUID, arbitrary prompts, unsupported anatomy or unreviewed image payload reaches model messages. CI never invokes paid providers or sends patient data.
