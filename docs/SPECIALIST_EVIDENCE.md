# Local specialist Evidence — research increment

After a successful local R231 result, the browser now builds source-bound
segmentation Evidence and shows it alongside the returned MPR mask. A manually
imported mask/passport pair also produces Evidence after matching the prepared
source package. A geometry-only mask import does not claim model provenance.

`web/lib/segmentation-evidence.ts` creates `opus-specialist-evidence/v1`:

- Request ID, salted source identity and exact input/mask/weights SHA-256.
- Source and mask grids in LPS millimetres, loaded frame count, unconfirmed coverage.
- Declared model ID/version/task, specialist producer and execution mode.
- Per-label native voxel count, mask volume in ml and bounds in mask indices.
- An occupied voxel's LPS point for MPR navigation; this is not a lesion centre.
- Unverified research status, limitations and local review decisions.

Volume is `voxel count × abs(affine determinant) / 1000`. It is the volume of
labels in the loaded slices, not a claim of complete organ coverage or accuracy.
Empty/absent labels never create zero-volume anatomy, a diagnosis or a normal
finding. Confidence, lesion diameter, clinical Dice and automated conclusions
are not invented. Manually imported passports do not establish an execution mode
or authentic model author; their mode is `not-recorded`.

## Browser behaviour

The Evidence card can select a label and synchronise all three MPR planes to its
occupied point. Coordinates are checked against the active volume. Local marks
are `unreviewed`, `requires_recheck` and `rejected`; no control signs or clinically
verifies a result. Rejection keeps the mask visible for comparison. Marks are
included in an explicit local JSON download and otherwise live in page memory.
Successful replacement, mask deletion and series/MPR teardown discard the prior
review. A failed replacement retains the previously bound mask and Evidence.

The builder makes one bounded pass over the existing mask, yields every 32,768
voxels and supports cancellation. It retains O(label count) metadata, without
copying/retaining an additional image/label volume. Raw DICOM, tokens, UIDs and
source filenames are not fields of this export. Arbitrary imported model text
and linked hashes/coordinates are not guaranteed anonymised: do not send the
export to an external provider without the existing verified privacy gates.

## Verified boundary

The latest user-supplied Mac report for `4528b24` is recorded separately in
`verification/r231-tensor-lifetime-mac.json`: real partial-reference R231 PASS,
730.64 MiB model peak, no whole-system swap growth and completed post-observation.
It predates this UI and is not Evidence UI acceptance. No model was rerun to
implement this increment.

Validation for this branch: 173 Web unit/contract tests, TypeScript/production
build and the synthetic browser regression. The browser checks bound Evidence,
local decisions/download, MPR point navigation, source rejection and lifecycle
cleanup. Synthetic predictions are not real-model/clinical evidence.

Four execution modes remain the architecture; only the existing local adapter
is connected automatically. No patient, remote or paid provider route is enabled.
The existing LLM `opus-evidence/v1`/orchestra importer is a separate research
contract: this export is not yet reimported there. A common specialist/LLM
comparison adapter, disagreements, persistent versioned physician audit and
clinical sign-off remain planned. R1, full native chest and Safari remain PARTIAL.
