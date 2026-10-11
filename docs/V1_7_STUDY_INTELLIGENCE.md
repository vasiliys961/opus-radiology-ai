# Opus Radiology AI v1.7 — Study Intelligence and fail-closed medical cloud privacy

Implemented in branch feature/v1.7-study-intelligence-privacy. This is
a local DICOM metadata module and a security foundation, NOT a clinically
validated protocol-detection, anatomy-completeness or de-identification engine.

## Working functionality

1. DICOM indexer extracts only strictly allowlisted body region codes (e.g.
   HEAD, CHEST, ABDOMEN) from BodyPartExamined; nonstandard text is discarded.
   It does not extract or display free-text ProtocolName, SeriesDescription,
   patient names, private tags, contrast-agent names, or identifiable images.
2. ImageType tokens distinguish localizers, primary and derived images.
   Standard MR scanning sequence codes and positive bounded values of TR,
   TE, TI and slice thickness are extracted without retaining descriptions.
   Preliminary MR T1-like, T2-like and IR/FLAIR-like labels are *technical
   hypotheses*, not confirmed protocols. No DWI/ADC, contrast phase, injection
   or disease subtype can be inferred from these tags alone.
3. All indexed series are assessed independently, regardless of which
   series is shown in 2D/MPR/3D. Technical warnings include inconsistent
   region codes, changing scan timings, missing geometric readiness,
   localizer-only content, duplicate SOPs, multi-frame files, differing
   StudyInstanceUIDs, mixed modalities and unindexed file counts.
4. Spatial source distance between first and last slice is shown ONLY if
   uniform volume geometry was validated, and cannot establish whole-organ
   coverage.
5. The metadata parser additionally records restricted, exact CS-valued privacy
   indicators: BurnedInAnnotation (0028,0301), RecognizableVisualFeatures
   (0028,0302) and PatientIdentityRemoved (0012,0062). YES for the first two
   or NO for the third causes a visible warning. Missing indicators are
   explicitly unknown. Even BurnedInAnnotation=NO and PatientIdentityRemoved=YES
   are NOT independently verified evidence that identifying pixel content,
   private attributes or recognizable faces are absent.
6. The workstation has a collapsible, filterable study dashboard with
   click-to-series navigation, even when the scanned study is multi-series.
6. Full-organ coverage, complete MRI protocols, all CT phases and diagnosis
   cannot be certified from the currently available data. The output always
   carries completeness=not-verifiable. A series can be MPR-ready and still
   miss multiple sequences or clinically important slices.

## Cloud patient data: WHAT IS ACTUALLY SAFE NOW

The previous POST /api/ai accepted arbitrary JSON payloads if a shared
development bearer token was set. The endpoint has been RETIRED and now
always responds HTTP 410, Cache-Control: no-store. No image or free-text
payload is read and no provider call is made from this endpoint.

The only experimental cloud route is POST /api/ai/orchestrate. It:
- is disabled by default and requires a server-side token and explicit flag;
- accepts ONLY provider and modality, rejects unrecognized fields;
- creates only mathematical nonpatient grayscale PNGs on the server;
- has NO path to uploaded user DICOM, JPEG/PNG or clinical context.

web/lib/patient-cloud-policy.ts records the future production safety
requirements but deliberately cannot grant release. Even if all booleans
were asserted by an untrusted caller, permitted remains false.

Production patient transmission STILL REQUIRES:
- physician authentication with server-side session and scoped authorization;
- lawful consent and the applicable regulatory basis for each study;
- DICOM PS3.15-compatible de-identification of standard and private tags;
- manual/verified detection and treatment of burned-in pixel text, faces,
  biometrics, and identifying annotations without damaging diagnostic anatomy;
- trustworthy transport audit, provider agreements, region and retention policy;
- per-study permitted transmission scope and clinical-safety validation;
- tests against PHI leakage, wrong patient/source matching and expired consent.

Do NOT label a study "de-identified" on the basis of removing tag text alone.
Do NOT add a consent checkbox that bypasses the trusted server requirements.
Never store model provider keys, raw DICOM or patient metadata in git.

## Roadmap position

- v1.7 Study Intelligence: technical metadata, geometric warnings, protocol
  hypotheses and all-series UI — now implemented, with explicit limitations.
- v1.8 Gemini Orchestra: existing server-side roles and synthetic-only guarded
  research endpoint remain; real patient imagery requires approved safety pipeline.
- v1.9 Clinical Orchestra: clinical critic, evidence adjudication and signed
  professional review require dedicated clinical and authorization validation.
- v2.0 Spatial Intelligence: GPU/remote TotalSegmentator worker and 3D spatial
  mapping require controlled geometry/benchmark deployment. NV research-only.
- v2.1 Longitudinal Radiology: longitudinal registration, provenance and
  timepoint controls are a later stage.

## Verification

Run inside web/:

    npm ci
    npm test
    npm run typecheck
    npm run build
    npm run test:browser

The synthetic browser test checks the new all-series UI, DICOM linkage, MPR,
3D and that the retired raw gateway returns HTTP 410 without reading payload.
