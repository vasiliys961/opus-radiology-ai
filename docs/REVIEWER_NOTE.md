# Local reviewer note — unsigned draft

The specialist Evidence card now has a separate plain-text reviewer editor. This
text does not modify source pixels, mask measurements, LLM claims or review
decisions. It is an unverified local draft, not an authenticated physician opinion
or signature. It is never prefilled from model output or sent to a provider.

## Workflow and contract

Explicit save appends a version; unchanged text against unchanged review is a
no-op. Clearing text and saving records an empty version, retaining prior text.
Reset of unsaved edits restores the last saved text without changing history.
Unsaved edits disable full Evidence/comparison JSON and HTML report downloads,
so newly typed text cannot be silently omitted. The status journal stays available.
Pending imports cannot overwrite a newer click/edit or resurrect an unmounted card.

Each version binds to request/source/input/mask/weights/model and the exact
canonical status-review prefix via SHA-256, not merely its count. Review changes
leave the old note visible/exportable with a recheck warning. Explicit saving
after inspection binds a new version, even when the text is unchanged. It never
approves the note clinically.

`opus-reviewer-note/v1` contains research status, unverified provenance, the
existing full review binding and contiguous note versions. A version includes
review revision/digest, plain text, declared UTC time and an unverified actor.
Standalone JSON restore requires the same verified source and available exact
review prefixes. Wrong binding/digest, missing/future/forked review, malformed
versions/time/text, signed status/actor or older/forked note files are rejected.
Existing versions must remain an identical prefix. Only note text/history is
restored; imported measurements, images and unknown properties are ignored.

Full Evidence/comparison JSON includes saved note versions. HTML has a separate
reviewer-draft section with only the latest text and stale/cleared/missing state.
Text is escaped under the existing no-network/no-script policy. A note never
changes comparison results or converts rejection into approval.

## Limits and privacy

Limits: 4,000 UTF-16 code units per version, 32 versions and 512,000 UTF-8 bytes
per import. Limits refuse changes without truncating saved history. Hashing uses
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

207 Web tests cover immutable/no-op/clear versions, stale detection/reconfirmation,
source/model/review-prefix binding, bounded strict restore, older/forked refusal,
escaped reports and unknown opaque fields. Synthetic browser checks unsaved export
blocking, save/export, stale state, reconfirmation, restore/refusal, reset of edits,
HTML output and teardown. No medical model/paid provider is rerun. Four modes and
R1/Safari/full-chest/clinical boundaries remain unchanged.
