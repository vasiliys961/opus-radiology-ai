# Synthetic provider usage — 2026-10-12

Baseline main `22dc41b` includes manually merged PR #31 and green Web Actions.

## Implemented

The successful localhost-only synthetic trial now exports additive `usage` in
`opus-synthetic-trial/v1` and displays a five-row token/cost table. Launch order
(anatomy, observations, quality, critic, synthesis) is preserved even when the
three parallel Vision responses complete in another order. The number of calls,
models, requests, output-token ceilings and authorization gates are unchanged.

`opus-provider-usage/v1` contains provider, requested model per step, numeric
prompt/completion/total token counts, optional cached/reasoning subcounts and
provider-reported cost. Polza documents `usage.cost_rub` and its `cost` alias in
RUB; OpenRouter reports `usage.cost` in USD credits. No currency conversion,
static tariff calculation, extra billing lookup or paid completion is performed.

Missing/invalid/nonfinite/negative/string values are null, not zero. Inconsistent
Polza aliases or token totals become unknown. A grand total is available only
when all five calls report that metric; known per-call values remain visible
when the aggregate is unknown. Cache/reasoning details are never added again.
Only explicit numeric fields are copied, not raw usage, provider IDs, arbitrary
metadata, prompts, credentials or pixels. Old v1 exports without usage remain
valid and are shown as unknown cost. Tiny positive prices use scientific notation
rather than rounding to a displayed zero.

This is provider-response accounting for a completed trial, not an authenticated
billing ledger, account balance, spending cap or invoice. Failed/cancelled calls,
BYOK upstream charges, taxes and other account activity may not be represented.
No successful usage report is produced when inference/JSON validation fails.
Production preflight worst-case costs, persistent partial-failure accounting,
daily/monthly budgets and idempotent billing remain PLANNED (COST-02 PARTIAL).
Cancellation does not guarantee an upstream stop or refund.

## User-supplied live result

On 2026-10-12 the user supplied `opus-synthetic-orchestra-ct-chest.json` from their
Mac. It declares remoteInferencePerformed=true and patientDataSubmitted=false,
OpenRouter, Gemini 3.8 Flash and Sonnet 5.5, two nonpatient mathematical frames,
all three Vision roles, critic and text synthesis. Eight observations are present;
four require recheck and uncertainty is retained in the research draft. This is
a user-supplied completed synthetic result, not an independently authenticated
provider receipt, trained segmentation run or clinical validation. Its original
export has no usage; actual tokens/cost cannot be reconstructed from that file.
No raw response, source identifiers or uploaded JSON is committed here.

## Verification and limits

262 unit tests pass, including malformed/missing/zero/overflow accounting,
Polza currency/aliases, allowlisted metadata and out-of-order integration.
Typecheck, production build and synthetic Chromium checks cover complete RUB,
partial unknown cost, legacy no-usage and JSON export. All completions are mocked;
no new paid run or medical-model inference is required for verification.

Patient Cloud remains disabled and /api/ai remains HTTP 410. Four execution modes,
specialist/optional-LLM Evidence separation, .env.local, R231/Safe/SHA/MPR/resource
contracts remain unchanged. No Mac memory, Safari/full CT or accuracy claim.

Primary references checked on 2026-10-12:
- https://polza.ai/docs/osobennosti/usage.md
- https://openrouter.ai/docs/api_reference/overview
