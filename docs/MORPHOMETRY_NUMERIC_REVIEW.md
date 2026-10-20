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
WMH inference all fail. It does not display numeric measurements until the
operator enters the separately confirmed original source CT/MRI SHA-256.
An HTML file chooser reads locally with file.text(); no network fetch or
upload. Clearing file resets stale previously selected study data.
The results still are **not** an automatic attachment to a patient's series:
local hash entry attests study association and is not cryptographically
authenticated DICOM original acquisition. No 'normal', positive disease
diagnosis, clinical risk cutoffs or automated LLM interpretation is produced.

`web/lib/morphometry-evidence.test.ts` verifies the six exact research
formats and key rejection conditions. These are examples of numeric validation,
NOT real model inference on positive studies, independent Dice or physician
calibration. Full original model/CT provenance and safe deidentified transmission
remain separate.
