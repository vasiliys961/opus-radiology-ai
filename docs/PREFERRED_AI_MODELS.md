# Preferred Vision/evaluator profile — 2026-10-12

Baseline main `5f65cfe` includes manually merged PR #29 and green main Web Actions.
User-selected profile: Gemini 3.8 Flash for Vision; Sonnet 5.5, Opus 5.5 or
GPT-6.1 Sol as the explicitly selected image evaluator and text synthesizer.
This is a preference profile, not a measured ranking of radiological accuracy.
A new model requires an explicit registry change and task/capability validation;
other catalogue entries never enter the list automatically.

## Fixed behavior

The old provider-quotas/alphabetical first-14 selection exposed Gemini 2.5,
GPT-3.5/4, batch and image-generator variants and silently chose the first
available entry in a second independent demo picker. That picker is removed.
The synthetic trial now reuses the main panel's exact model IDs and provider.
Missing exact model/modality blocks the trial instead of substituting any model.

Both metadata catalogues use fixed GET endpoints, server-side bearer for the
selected gateway, no redirect, a 10-second timeout and an 8 MB response bound:
`https://openrouter.ai/api/v1/models`, `https://polza.ai/api/v1/models`.
Polza's documented architecture.input_modalities/output_modalities matches the
existing strict parser. Only explicit image/text input and text output qualify;
a model name alone cannot prove capabilities. Public, unauthenticated catalogues
were checked on 2026-10-12 and contained all four exact IDs with these modalities;
that is not a paid account-specific inference/access check.

The paid localhost/dev-only synthetic endpoint accepts an explicit provider;
legacy requests without it retain OpenRouter semantics. Exact curated IDs and
fresh provider catalogue/modalities are checked server-side before completions.
The chosen Vision handles three roles; the selected evaluator reviews images
and then synthesizes text. This remains five calls, not three independent model
families voting, and not three evaluators simultaneously. Evaluation conflicts
remain visible; no model output becomes a clinical acceptance.

GPT-6.1 Sol, Sonnet 5.5 and Opus 5.5 do not advertise temperature in either current
gateway catalogue; the gateway omits that parameter for these versions. The existing 1,200 output-token ceiling,
one active trial/four starts per ten minutes and explicit paid acknowledgement
remain. Longer reasoning/JSON can still hit that ceiling; no claim of new live
completion reliability is made. No paid test was run for this change.

Cancel or selection/unmount aborts the client request; the server combines its
request signal with the existing 240-second timeout. Late responses cannot be
presented as the newly selected model's result. Already performed provider work
may still be billed; cancellation is not a refund or guaranteed upstream stop.
A provider/key mismatch never triggers a different gateway automatically.

## Run on the user's Mac

After manual merge, pull main, run `npm run dev` from `web`, select Polza or
OpenRouter, Gemini 3.8 Flash and the desired evaluator in AI-оркестр, then click
Проверить for that gateway. An existing corresponding server key is sufficient;
no RADIOLOGY_*_MODEL edit is required for this browser trial. No .env.local was
read or changed by this development increment. If a key is absent, network/model
calls stop and UI reports it. Accept the paid synthetic-only checkbox only when
ready, then start the named gateway test. This still uses generated mathematical
PNG frames, never loaded DICOM, privacy candidates or clinical text.

Patient Cloud/main hybrid analysis remains disabled until independently verified
privacy, authorization and processing controls. No false claim of clinical
readiness, production audit, Mac memory reduction or Safari/full CT acceptance.
Four execution modes, specialized medical models through Evidence and R231/Safe/
MPR/resource/SHA limits stay unchanged.

## Verification and primary API references

252 Web tests; typecheck/build; synthetic Chromium exercises exact main choices,
Polza/OpenRouter payloads, no duplicate model picker and missing-model blocking.
Paid completions are mocked. Unit checks validate selected critic routing, Polza
URL/key isolation, no legacy/batch substitution, evaluator image capabilities and
GPT request parameters. Read-only dev smoke uses absent keys and never contacts
providers. Existing privacy/mask/MPR/Evidence/OCR regressions remain.

- https://polza.ai/docs/gaidy/models
- https://polza.ai/docs/gaidy/models.md
- https://openrouter.ai/docs/guides/overview/models
- https://openrouter.ai/google/gemini-3.8-flash
- https://openrouter.ai/anthropic/claude-sonnet-5.5
- https://openrouter.ai/anthropic/claude-opus-5.5
- https://openrouter.ai/openai/gpt-6.1-sol
