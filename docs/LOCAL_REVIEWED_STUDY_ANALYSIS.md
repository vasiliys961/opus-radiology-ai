# Local reviewed-study analysis

Ordinary `/viewer` analysis now opens the existing source-bound sampled-frame
privacy workflow, rather than the public-reference-only automatic volume route.
Original DICOM stays local. Up to four PNG copies undergo OCR, redaction and
separate pixel/recognizability review; the clinician must authorize lawful
disclosure, provider health-data terms and the two paid Gemini/Opus calls.
This does not certify anonymity, authorize arbitrary patient transfers, validate
diagnostic accuracy or enable production patient-cloud release.

An explicitly provisioned development workstation may avoid manual operator
password entry for this exact route. Keep the existing provider key in
`web/.env.local`; do not copy or rewrite it. An administrator may put only these
settings in the Git-ignored `web/.env.development.local` after verifying the
processing arrangements:

```dotenv
RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT=1
RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED=1
RADIOLOGY_LOCAL_REVIEWED_FRAME_SESSION=1
```

After starting `npm run dev`, the primary **Анализировать исследование** action
automatically connects the preapproved workstation while preparing frames.
Opening DICOM files alone never establishes this connection. A failed check
offers **Повторить проверку подключения** without rerunning a detector or
initiating paid inference. Standalone technical panels retain manual connection.
Connection issues a four-hour HttpOnly, SameSite=Strict cookie scoped to
`/api/ai/deidentified-openrouter-review`. It authorizes neither the automatic
public-volume endpoints nor any new image. Every submission still passes the
existing exact-copy privacy journal, payload, acknowledgement and provider gates.
No image or paid inference is sent by connecting. The legacy manual operator
password path remains available; late detector reconciliation still uses it.

The public automatic volume research path remains in `/viewer?research=1` with
its own existing server permission. Missing/failed authentic local detectors
remain not assessed; a cloud report does not manufacture detector results.
