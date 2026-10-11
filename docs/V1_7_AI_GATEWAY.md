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
