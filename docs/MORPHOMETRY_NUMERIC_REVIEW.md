# Morphometry numeric-only results in the Opus viewer

New physician research UI tab **Морфометрия · 6 областей** on /viewer.
Existing independent research scripts cover original (1) heart and thoracic/
abdominal vascular anatomy; (2) lumbar vertebra CT HU; (3) liver-spleen
noncontrast HU; (4) original white matter FLAIR WMH candidate mask; (5)
high-HU gallbladder interior candidates; (6) hip/pelvic bone surface distance.

The browser accepts ONLY a 128 KiB research numeric JSON (not images or masks).
It validates one exact known schema, explicit clinicallyValidated:false, a
64-character source CT/MRI SHA256, and bounded numeric fields. Invalid schemas,
NaN, nonfinite values, unsupported conditions and pretending original trained
WMH inference all fail. It does not display numeric measurements until a local original NIfTI (.nii/.nii.gz) CT/MRI is selected and its
**complete binary SHA-256 calculated in-browser** matches the research JSON.
An HTML file chooser reads locally with file.text(); no network fetch or
upload. Clearing file resets stale previously selected study data.
The results still are **not** an automatic attachment to a patient's series:
a matching hash establishes byte identity between the selected original
NIfTI and the claimed report hash but not its clinical provenance, license,
expert reference or raw DICOM acquisition history. No 'normal', positive disease
diagnosis, clinical risk cutoffs or automated LLM interpretation is produced.

`web/lib/morphometry-evidence.test.ts` verifies the six exact research
formats and key rejection conditions. These are examples of numeric validation,
NOT real model inference on positive studies, independent Dice or physician
calibration. Full original model/CT provenance and safe deidentified transmission
remain separate.

## Exact local original NIfTI byte match

The UI no longer accepts manually typed SHA-256 as proof. A separate user-
selected local .nii/.nii.gz file is hashed in 2-MiB chunks via the existing
@noble/hashes incremental SHA-256 package. It refuses source files over
900 MiB or under 256 bytes, displays bounded progress and stops when the user
changes report or clears the session. Only a byte-identical source digest
unlocks the numeric fields. The selected NIfTI never leaves browser memory;
no full 3D image array is decoded. This is a **content-identity** gate,
not verification of clinical interpretation, authorized model use or
patient data deidentification.
