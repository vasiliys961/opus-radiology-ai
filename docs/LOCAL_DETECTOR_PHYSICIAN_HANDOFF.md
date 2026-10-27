# Local source-bound detector → physician review handoff

The existing unified CT/MR launch calls `dispatchDicomDetectors`; after it
returns, the physician can save a local, unsigned research Evidence draft.
This is a structured handoff, **not a new detector, model call, second
orchestrator or a clinical final report**.

The new `opus-local-detector-physician-review/v1` contains:
- Exact original DICOM Series Instance UID and SOP Instance UID for each
  candidate and the matching *currently opened* local file ID.
- Actual executed models, their restricted coverage, model provenance,
  unsupported model targets and failure reasons.
- An explicit `requires_recheck` status for every candidate, never
  an assertion of physician validation.
- The absence of candidates is represented as **no evaluable diagnostic
  conclusion**, never as normal CT/MR or exclusion of hemorrhage.
- No background transmission: the JSON is downloaded only on a direct
  physician button click, and no cloud consent is inferred.

The source IDs are potentially sensitive clinical metadata; keep the JSON
locally. Do not email or upload it to OpenRouter/Gemini/Claude without
separate lawful authorization and source-identifier minimization.

Detectors remain research-only until real trained checkpoints have performed
prospective source-bound inference and independently validated performance.
A source UID confirms mapping to the open scan, not the diagnostic accuracy
of a prediction.

The existing `runAutoDicomConsilium` can consume verified local model
Evidence in its authorized cloud mode, but the standalone privacy pilot
does **not automatically transmit these original-source identifiers**.
The unsigned handoff is deliberately separate.
