# Opus CPU detectors → Gemini + Opus: integration and real-study privacy gates

## What is now connected (without GPU)

The pathology coverage screen contains an independent **Gemini 3.8 Flash + Claude Opus 5.5** detector evidence review. Readable from \`PathologyCoverageResearch.tsx\` → \`DualPublicDetectorReview.tsx\` → restricted server route \`/api/ai/dual-public-detector-review\` → \`reviewPublicDetectorsWithTwoLlms()\`.

The backend reads **three immutable real public source-scoped model case reports** already shipped as verified research examples:
- Pulmonary nodule: MONAI RetinaNet on one original public LUNA16 CT; expert center comparisons, **training overlap not ruled out**.
- Head hemorrhage: genuine ianpan CT hemorrhage and TotalSegmentator cerebral_bleed on original public head CT; no independent expert blood mask.
- Chest effusion: original TotalSegmentator 2.18.0 pleural/pericardial model on original public LCTSC CT; one 32 ml **model mask**, not clinician-confirmed effusion.

Only allowlisted **numerical evidence strings and limitations** go to both models. Gemini and Opus call the provider independently; both are bounded to the original known fact IDs via \`parsePublicLLMReview\`. The UI presents two separately attributed drafts, per-fact priority conflicts, unresolved questions, facts neither highlighted and physician warnings. **Not a majority vote, no automatic diagnosis.**

Run this optional research-only paid demo on \`localhost\` in Next development environment, with a server-side API key already configured for the selected provider and:

    RADIOLOGY_ENABLE_DUAL_PUBLIC_DETECTOR_LLM=1

The provider must actually offer both configured model IDs. There is no forced fallback or pretending a missing model ran. One active request, max two starts per 10 minutes, explicit acknowledgement of two paid model calls; no DICOM, filenames, original study UIDs, patient info, arbitrary user prompts, raw CT images or external patient inference are accepted in this route. A user cannot upload new model findings to it. No new GPU is required; pretrained results come from actual earlier CPU executions on public references. This is meaningful LLM interpretation of real model **results**, not new trained-model inference.

## User-requested NEXT product behavior: deidentified clinical CT/MRI → two external LLMs

**The intended product is allowed to send properly deidentified real clinical CT/MRI images to Gemini and Opus once legal and security controls are independently verified.** The user does not want a permanent ban on cloud imaging. This PR does **not** enable raw or reviewed private image transfer by browser assertions. The existing \`patient-cloud-policy.ts\` remains OFF because no audited trusted-server clinical authorization exists. It must not be bypassed by a checkbox, bearer token, OCR-only scan or model name.

A production-capable study route must implement:

1. **Local preprocessing**: decode DICOM locally, strip/rebuild images from pixels only, remove burned-in name/date/ID/clinic annotations with actual irreversible raster redaction and re-encode without PNG metadata; also handle recognizable faces/3D craniofacial reconstruction and rare unique identifiers. The present \`VisionPrivacyPreparation\` already does bounded raster creation, metadata stripping, optional OCR, pixel redaction and SHA-bound manual reviews. Those alone do **not** certify anonymization.
2. **Independent study-level de-identification assessment**: validate DICOM metadata and private tags; detect remaining embedded annotations and visual/biometric identifiability; if uncertain, block or require trained privacy officer review. Ensure final *exact outgoing bytes* match the reviewed SHA; changing pixels revokes previous approval. Even sanitized pixels can retain sensitive patient health data and fall under applicable privacy regulation.
3. **Trusted server authorization**: authenticated clinician with assigned role, documented lawful basis/consent as applicable and per-study authorization; independent of browser-provided true/false fields. Approve provider identity, processor contractual terms, retention, geography/cross-border transfer and data minimization.
4. **Protected execution**: authenticated TLS service, rate limits, cost limits, required model capabilities, short-lived signed study-bound approvals, bounded frames, audit (non-PHI), revocation and correct lifecycle/retention. Do not transmit original DICOM UIDs/hashes, original filenames, source tags, free-text reports or identity mapping to the provider.
5. **Evidence reconciliation**: separate specialist model findings from Gemini Vision observations and Opus critique, bind all findings to the **local private source-index mapping** without leaking that mapping to the provider. Treat unobserved anatomy as unassessed, require an accountable physician and evaluate accuracy on independent studies.

After completing these checks, a dedicated *authenticated production* route can call the existing \`runVisionOrchestra\` with approved deidentified pixel frames and deidentified specialist findings; the local browser restores original study navigation using a separately held internal mapping. The cloud never needs DICOM identifiers.

**Current limitation:** this PR provides a usable opt-in public clinical research evidence bridge with two real external LLMs and existing CPU specialist inference reports. The proposed patient image route is **not yet active**, so no real patient CT has been sent to Gemini/Opus and no deidentification of patient data is independently proven. The patient-cloud gate stays explicitly closed pending server controls and lawful approval.
