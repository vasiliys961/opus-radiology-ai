# Local research review history

The specialist Evidence card records status changes as a bounded, versioned local
journal. Changing or resetting a label appends a transition instead of discarding
earlier decisions. The current status still controls numeric/spatial comparison:
an imported or newly rejected target cannot become an accepted LLM comparison.
The mask and measured volumes remain unchanged and visible for review.

## Contract and workflow

`web/lib/evidence-review-history.ts` implements `opus-evidence-review/v1`:

- Binding: request ID, source identity/input/mask/weights SHA, model ID/version.
- Events: contiguous revision, observation ID, previous/new research status,
  declared UTC timestamp and literal `local-unverified-reviewer` actor.
- Provenance: `local-unverified`, never an authenticated clinician or signature.

Allowed statuses remain `unreviewed`, `requires_recheck` and `rejected`.
Repeating the same status is a no-op. Reset is a recorded transition to unreviewed.
Revision establishes ordering; device/imported clocks are untrusted and may move
backwards. The UI displays local time; export retains the declared UTC timestamp.
No clinical verification, signed final report or identity assertion is introduced.

`Скачать Evidence JSON` includes the current measurements, decisions and
`reviewHistory`. `Скачать сопоставление JSON` includes the same reviewed specialist
snapshot. `Скачать историю JSON` creates the standalone journal for the card's
`Восстановить историю JSON` input. Import accepts the standalone journal only,
not a general Evidence/LLM file. All downloads require an explicit user action.

Restoration applies only decisions onto currently verified Evidence; it does not
accept imported measurements, geometry, labels, buffers or source metadata. Every
binding field must match. Replay validates known observations, contiguous revisions,
from/to state continuity, non-no-op transitions, canonical timestamp format and
the unverified actor. Unknown extra fields are dropped. Promoted clinical statuses
or a claimed authenticated author are rejected.

Fresh current Evidence can restore a matching saved journal. If the active card
already has changes, the imported journal must match their entire prefix and
either be identical or extend it. Older/forked versions cannot erase local work.
To undo a decision use the status controls, which append a new event. A pending
file read cannot replace a newer local click/import or resurrect an unmounted card.
Invalid import leaves both previous decisions and history intact.

## Resource, persistence and privacy boundary

The journal allows up to 512 events and 256,000 UTF-8 bytes per import. At the
event cap a new decision is refused with a visible message, preserving every
event and the current state. There is no rolling truncation. State grows only
with metadata; no additional image/mask buffer or model execution is introduced.

State lives in page memory and explicit local files. Successful mask replacement,
deletion or MPR/series teardown discards that card's in-memory history. There is
no automatic localStorage/IndexedDB persistence, server database or remote upload.
A different job/request/model/mask cannot inherit an old review silently, even if
the same public reference is loaded again. Keep/download a needed journal before
teardown; restoring requires exactly its verified bound result.

The journal has no comment, patient-name, raw UID, filename, token or image fields.
Linked hashes/IDs and model text in the full Evidence are not proof of de-ID; keep
exports local under the existing patient/cloud/remote OFF policy. The author and
clock are declarations, and JSON can be edited outside the application. This is
not an immutable, tamper-proof or authenticated clinical audit. Signed clinician
access, protected persistent storage, trusted timestamps, controlled retention and
versioned clinical sign-off remain planned.

## Checks

From `web/`:

```bash
npm test
npm run typecheck
npm run build
npm run test:browser
```

192 Web tests cover immutable/no-op/reset transitions, fresh/extended restore,
every binding field, malformed/forged continuity, timestamps, clinical-status
refusal, limits, metadata allowlisting and comparison rejection after review.
The synthetic browser regression checks journal export/restore, retained reset
history, foreign/older/forked refusal, comparison refresh and lifecycle deletion.
There is no trained-model/LLM rerun, Mac memory benchmark or clinical acceptance
in this increment. Four execution modes and all voxel/MPR/resource guards remain.
