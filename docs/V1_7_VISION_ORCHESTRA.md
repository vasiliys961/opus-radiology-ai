# v1.7 — Gemini Vision Orchestra, synthetic integration milestone

Branch: feature/v1.7-gemini-orchestra

## Implemented code

- web/lib/vision-orchestra.ts: 3 independent vision roles (anatomy, observations, quality) running concurrently; a separate image-based critic; then a text-only GPT/Claude clinical draft.
- web/lib/synthetic-vision-phantom.ts: true PNG 96x96, generated on server, no DICOM or patient-derived images.
- web/app/api/ai/orchestrate/route.ts: disabled-by-default, authenticated endpoint. Takes only provider + modality. No arbitrary image/frame/clinical-context uploads.
- web/lib/vision-orchestra.test.ts: mocked providers, strict JSON and source-image validation, MIME check, non-diagnostic output guards.

## One-way graph

Synthetic PNG slices → Gemini anatomical observer / Gemini visual observations / Gemini technical quality observer
→ Gemini independent visual critic → structured opus-evidence/v1 → GPT/Claude research draft.

Calls route through selected Polza or OpenRouter ONLY; no automatic cross-provider fallback.
Each role sees 1–4 limited, individually identified sample frames (only 2 in the fixture).
Results are bound to supplied imageId and seriesUID, frameIndex and known position;
no physical measurement is inferred from a picture. Every observation remains candidate
or requires_recheck and can never become verified_by_human by model output.
Missing anatomical coverage is explicitly not assessed. A failing stage fails the run
and does not silently generate a normal study or clinical narrative.

**No real patient data is accepted** by the synthetic research endpoint. This is a
connectivity/schemas/provenance integration test, **NOT** medical evaluation or
pathology detection. These phantoms are generated mathematically and must not be
used as clinical benchmark data.

## Local developer test (only with provider consent, model access and account credits)

Add to web/.env.local (values are examples; do not commit secrets):

    RADIOLOGY_AI_GATEWAY_TOKEN=<random-long-server-secret>
    RADIOLOGY_ENABLE_SYNTHETIC_AI=1
    POLZA_API_KEY=<server-only-secret>
    RADIOLOGY_POLZA_VISION_MODEL=<real-polza-vision-capable-model-id>
    RADIOLOGY_POLZA_CLINICAL_MODEL=<real-polza-reasoning-model-id>

For OpenRouter use OPENROUTER_API_KEY,
RADIOLOGY_OPENROUTER_VISION_MODEL and RADIOLOGY_OPENROUTER_CLINICAL_MODEL.

Discover *actual* model IDs and capabilities in the chosen aggregator's catalogue.
There are no assumptions that two aggregators expose identical IDs. A model that
does not accept images or does not return JSON will fail visibly, without fallback.

With dev server running, use a server-side terminal (never put the token into
browser JavaScript):

    curl -X POST http://localhost:3000/api/ai/orchestrate \
      -H "Authorization: Bearer $RADIOLOGY_AI_GATEWAY_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"provider":"polza","modality":"CT"}'

The request body allows ONLY the two fields above; the server creates the test PNGs.
Expected output: opus-orchestra/v1, sourceImages (metadata, no base64),
roleResponses, critic, evidence (opus-evidence/v1), clinicalDraft, clinicalStatus
unverified_research_draft. The endpoint will fail closed when credentials,
research flag or compatible models are absent.

## Medical deployment blockers

Before connecting real CT/MR patient images, implement:

1. Authenticated physician session and role/organization policies, not a shared developer bearer.
2. DICOM de-identification according to appropriate profiles, verification of
   burned-in text and biometric/facial information, explicit lawful consent,
   audit, retention and transmission policies.
3. Frame/volume sampling strategy with physical DICOM spatial indexing, coverage
   and sequence detection, no JPEG-from-CT quantification and complete spatial provenance.
4. Independent validation on representative normal/pathological studies, with
   per-anatomy sensitivity/specificity, false-positive/negative review.
5. Bounded provider quotas and timeouts, capability checks for Gemini vision,
   separate server inference worker for TotalSegmentator (NV research only).
6. Medical reviewer UI connecting every observation to exact source image,
   supporting accept/reject/recheck and signed human adjudication.

The clinical analysis button in the main app remains disabled until these blockers
are resolved. Do not expose the developer token or provider keys to the client.
