# Local reviewed-study analysis

Ordinary `/viewer` analysis now opens the existing source-bound sampled-frame
privacy workflow, rather than the public-reference-only automatic volume route.
Original DICOM stays local. Up to four PNG copies undergo OCR, redaction and
separate pixel/recognizability review; the clinician must authorize lawful
disclosure, provider health-data terms and the two paid Gemini/Opus calls.
This does not certify anonymity, authorize arbitrary patient transfers, validate
diagnostic accuracy or enable production patient-cloud release.

The ordinary reviewed workflow now uses OCR to **mark** possible text without
automatically painting over diagnostic anatomy. On a real public CT the former
automatic redaction removed tissue after OCR false positives. The physician can
select a marked region, redact an actual identifier and rescan, or explicitly
retain a visually verified false positive. SHA-bound reviews and disclosure
approval remain required; unresolved OCR cannot be silently bypassed. The
separate explicitly approved automatic public-volume research mode is unchanged.

A source-linked CT/MR reconstruction tagged `DERIVED` may enter this reviewed
visual path if its identities and geometry pass. Its native quantitative model
eligibility stays blocked; the tag is not rewritten. The viewer displays the
restriction instead of silently hiding the primary analysis action.

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

Actual local browser acceptance on 2026-11-02: the pinned public TCIA source
opened, four visually checked unchanged PNG copies reached real Gemini/Opus,
and an 1885-character preliminary report appeared with a successful TXT download
in 47.894 seconds. Only four frames of a declared 32-of-103-slice slab were
reviewed in the source soft-tissue window. No specialist model forward or
diagnostic accuracy is claimed. See
[the technical record](verification/reviewed-public-ct-mac-live.json).

The public automatic volume research path remains in `/viewer?research=1` with
its own existing server permission. Missing/failed authentic local detectors
remain not assessed; a cloud report does not manufacture detector results.
