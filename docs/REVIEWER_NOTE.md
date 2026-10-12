# Local reviewer note — unsigned draft

The specialist Evidence card now has a separate plain-text reviewer editor. This
text does not modify source pixels, mask measurements, LLM claims or review
decisions. It is an unverified local draft, not an authenticated physician opinion
or signature. It is never prefilled from model output or sent to a provider.

## Workflow and contract

Choose the general result or an existing mask label. Each has its own effective
latest text in the same bounded journal. Label targets use exact observation IDs,
not anatomy-name guesses. The MPR button uses the existing occupied-label anchor;
it does not locate a lesion or invent a new ROI, and remains an inspection action
even when the mask label is rejected locally.

Explicit save appends a version; unchanged text against unchanged review for
that target is a no-op. Clearing text and saving records an empty version only
for that target, retaining prior text and other targets. Reset of unsaved edits
restores the selected target's last saved text without changing history.
Target selection is disabled while edits are unsaved, preventing silent loss.
Unsaved edits disable full Evidence/comparison JSON and HTML report downloads,
so newly typed text cannot be silently omitted. The status journal stays available.
Pending imports cannot overwrite a newer click/edit or resurrect an unmounted card.

Each version binds to request/source/input/mask/weights/model and the exact
canonical status-review prefix via SHA-256, not merely its count. Review changes
leave the old note visible/exportable with a recheck warning. Explicit saving
after inspection binds a new version, even when the text is unchanged. Any review
change conservatively stales every saved target; reconfirming one does not
reconfirm the others. It never approves the note clinically.

`opus-reviewer-note/v1` (legacy general-only) and `opus-reviewer-note/v2`
(target-capable) contain research status, unverified provenance, the
existing full review binding and contiguous note versions. A version includes
review revision/digest, plain text, declared UTC time and an unverified actor.
Optional `observationId` must match an existing specialist observation exactly.
Omitted target means general note, preserving older v1 files and their prefixes.
The first targeted save upgrades the journal to v2; it stays v2 on later general
saves. Older clients refuse v2 instead of silently treating label text as general.
Targeted versions in v1 and unknown/nonstring/null targets are rejected rather
than remapped. Switching targets or restoring JSON reloads the selected target's
effective text.
Standalone JSON restore requires the same verified source and available exact
review prefixes. Wrong binding/digest, missing/future/forked review, malformed
versions/time/text, signed status/actor or older/forked note files are rejected.
Existing versions must remain an identical prefix. Only note text/history is
restored; imported measurements, images and unknown properties are ignored.

Full Evidence/comparison JSON includes saved note versions. HTML has a separate
reviewer-draft section with the latest text per target, source-resolved label
ID/name/observation and existing LPS point, plus stale/cleared/missing state.
Text is escaped under the existing no-network/no-script policy. A note never
changes comparison results or converts rejection into approval.

## Limits and privacy

Limits: 4,000 UTF-16 code units per version, 32 versions total across all targets
and 512,000 UTF-8 bytes per import. Limits refuse changes without truncating saved
history. Hashing uses
validated metadata and the existing pinned SHA library; no image/mask copy or
model execution. Staleness is memoized while typing unchanged Evidence.

Page memory and explicit local files only: no browser/server persistence, logs or
uploads. Free text can contain sensitive data and is not anonymised. Clearing the
latest text does not erase older saved text. Keep files local under patient/cloud/
remote OFF; `.env.local` is unchanged. Hashes/JSON do not authenticate the author,
clock or correctness. Protected storage, identity/signature, retention/erasure
controls and clinical approval remain planned. Teardown discards the card state.

## Checks

From `web/`:

```bash
npm test
npm run typecheck
npm run build
npm run test:browser
```

213 Web tests cover immutable/no-op/clear versions, stale detection/reconfirmation,
source/model/review-prefix binding, bounded strict restore, older/forked refusal,
independent targets, legacy compatibility, safe schema refusal, shared limits,
escaped reports and
unknown opaque fields. Synthetic browser checks unsaved export/target switching
blocking, save/export, target-specific MPR navigation, stale state, reconfirmation,
restore/refusal, selected-target draft retention, reset of edits, multi-target
HTML output and teardown. No medical model/paid provider is rerun. Four modes and
R1/Safari/full-chest/clinical boundaries remain unchanged.
