# Local text search for privacy preparation

Baseline main `d48f7ff` contains manually merged PR #26 and green Web Actions.
Local pixel-only copies now have optional real Tesseract OCR assistance. This is
text localization, not clinical inference, certified de-identification or a cloud
release. It never identifies a patient or claims every identifier was detected.

## Implemented workflow

Prepare copies in the Vision frame panel, select a copy and click **Найти надписи
локально**. One owned host/engine pair scans one image in English + Russian.
The initial scan removes the selected copy's local review marks. Results bind to
its exact SHA and contain bounded native-pixel rectangles and OCR confidence;
recognized words stay inside the worker and never enter React state, exports or
logs. Confidence is not a calibrated probability of privacy protection.

Select a region to show its outline and coordinates, then use the existing manual
redaction. **Скрыть найденные надписи** blacks all detected regions in one canvas/
encoding transaction if the remaining 32-region budget permits it. Rectangles are
padded by two pixels within native bounds. Original DICOM/MPR/Evidence stay intact.
Changes invalidate old OCR and manual review; rescan and inspect the new copy.

For genuinely non-identifying technical labels, the user can explicitly keep
them. This is a local, unauthenticated declaration, not an automatic classifier.
Detection count/regions are retained; acknowledging text does not falsely turn a
positive OCR result into zero. New scans clear that declaration. Manual checks
cannot be completed while detected text is unresolved.

Zero OCR detections never mark a copy as reviewed, anonymous, clinically normal
or eligible for cloud. Manual text/face review remains necessary. OCR is absent
from the exported candidate contract; `transmissionPermitted:false` and
`deidentificationVerified:false` are unchanged.

## Execution and assets

All code, cores and language files are supplied by the app through fixed GET-only
`/api/privacy-ocr/assets/v1/` paths. PNG bytes use worker messages, not HTTP.
Worker networking permits same-origin static OCR assets only and the pinned
core's embedded public WASM data URI. POSTs, request bodies, default CDN fallbacks,
redirects and credentials are denied. No browser OCR cache, image persistence,
provider call, patient-text logging or upload endpoint is introduced.

`npm install` / `npm ci` installs pinned packages; no additional Python, PyTorch,
GPU, API key or manual language installation is needed. The browser loads OCR
assets only on request. Language gzips total 5,632,471 bytes (about 5.37 MiB).
Package-lock integrity and exact per-file SHA checks guard deployed assets; a
missing/mutated file refuses service. Next output tracing includes the fixed
package files for deployment. Binaries are dependencies, not committed copies.

| Component | Pin | Licence/provenance |
|---|---|---|
| Tesseract.js | 6.0.1 | Apache-2.0, upstream package |
| Tesseract.js-core | 6.1.2 | Apache-2.0, upstream WASM core |
| English/Russian npm wrappers | @tesseract.js-data/eng and rus, each 1.0.0 | Package metadata declares MIT |
| Language checkpoint files | 4.0.0_best_int, exact gzip SHA in code | Integerized Tessdata Best; naptha/tessdata and upstream tessdata_best declare Apache-2.0 |

The exact served file paths/hashes are in `web/lib/privacy-ocr-assets.ts`; changing
packages/data requires re-verifying pins and incrementing the asset version.
This is not commercial medical-model licence clearance or clinical validation.

Primary references: [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/api.md),
[local installation](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/local-installation.md),
[language provenance/licence](https://github.com/naptha/tessdata),
[upstream language licence](https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE).

## Resource/lifecycle boundaries

- Existing one-Mpixel, 2-MiB-PNG and four-copy limits remain; one selected image
  per OCR job, no whole CT or volume copy, no automatic scan on upload.
- One shared same-tab admission slot serializes OCR and the local R231 action.
  R231 holds it through preparation/result/delete; OCR holds it through worker
  shutdown. Old release functions cannot unlock a newer job.
- Cancellation, source/unmount, failure or a 30-second timeout terminate owned
  engine/host workers and release admission, including initialization. A bounded
  host shutdown acknowledgement has a one-second fallback.
- This is not a cross-tab/CLI lock or an OS RAM reservation. Tesseract workers
  consume additional WASM memory; new M1/Safari/system/swap acceptance is pending.
  Existing worker RAM/RSS guards remain necessary and unchanged.

No defacing, independent pixel privacy audit, authenticated reviewer, provider
contract, server study authorization or clinical release is added. Patient cloud
and remote worker gates remain closed; four execution modes and optional-LLM/
specialist Evidence separation remain. `.env.local` is untouched.

## Checks

From `web/`: `npm test`, `npm run typecheck`, `npm run build`,
`npm run test:browser`. The browser test uses an isolated free local port.

230 Web tests cover strict SHA/coordinate allowlisting without reading OCR text,
shared admission, stale release, failure/initial cancellation/timeout teardown and
exact deployed asset hashes, preserving prior tests. The browser regression uses
actual Tesseract on synthetic English/Russian words, cancel/restart, positive
regions and retained human acknowledgement, actual black raster redaction,
unchanged original and zero rescan still requiring human checks. It verifies
fixed local GET assets and no pixel/text upload. DICOM/SHA/mask/MPR/privacy
regressions remain; no medical checkpoint or paid provider is rerun.

The local OCR lifecycle and manual decisions now have a bounded, unsigned
copy-bound journal with explicit downloads; see [PRIVACY_REVIEW_JOURNAL.md](PRIVACY_REVIEW_JOURNAL.md).
It is separate from the still-missing protected server audit.

Local bundle restoration shares the same-tab compute slot with OCR/R231,
resets OCR/acknowledgement and manual checks, and preserves the prior journal.
Restoring a saved decision does not replace current review.
