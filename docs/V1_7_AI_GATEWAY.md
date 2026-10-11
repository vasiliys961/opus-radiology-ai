# v1.7 — AI Gateway (first implementation)

Branch: `feature/v1.7-ai-gateway`.

This is the initial server-side foundation, **not** the complete Gemini Orchestra or a validated radiology inference system.

## Providers
- `openrouter`: `OPENROUTER_API_KEY`
- `polza`: `POLZA_API_KEY`

The physician's explicit provider selection is sent as `provider` in the request. There is **no automatic fallback** to the other provider. Model IDs must be verified against the selected provider's catalogue; model IDs are not assumed interchangeable.

## Endpoint
`POST /api/ai` with `Authorization: Bearer <RADIOLOGY_AI_GATEWAY_TOKEN>`.

JSON body: `{"provider":"openrouter","role":"vision","model":"<provider-model-id>","messages":[{"role":"user","content":"Test"}]}`.

This bearer-token gate is a development integration boundary, **not production physician authentication**. Never put the gateway token or provider keys into browser JavaScript. Production requires session-based physician authentication, authorization, quotas, auditing and an explicit consent/de-identification workflow for medical images. The API is intentionally disabled when the gateway token is not configured.

## Next
1. Physician settings UI and server-side persisted provider choice.
2. Provider-specific model capability discovery (image inputs, JSON schema).
3. Structured evidence JSON with strict schema validation and source-image references.
4. Gemini role orchestration, review loop and benchmark tests.
5. Independent anatomical segmentation adapter after verification of the pilot artifacts.

No patient images should be sent to external providers before the privacy controls are completed.

## Regional access and resource-constrained model policy

- A physician chooses Polza AI or OpenRouter explicitly. No IP-geolocation routing and no automatic cross-provider failover. Availability and specific model IDs must be checked in the selected provider's catalogue.
- **MedGemma is excluded from the v1.7 model registry** due to practical access concerns in Crimea. No Google model-weight download or Google-hosted service is required for the MedGemma role.
- **MedSAM2 / Efficient MedSAM2 is deferred**, not installed and not automatically downloaded. Consider only as an optional separate inference worker after benchmarks on the actual deployment hardware and licensing review. Its use must not block the CT/MR viewing or segmentation workflows.
- Gemini is retained as the vision model *through the user-selected aggregator*, contingent on confirmed availability there. This is not a direct Google API dependency.
- The anatomical segmentation pilot does not demonstrate pathology detection. TotalSegmentator remains the primary anatomical candidate; NV-Segment-CTMR remains research-only under its applicable licensing conditions.
