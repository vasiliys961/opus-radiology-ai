# One time-bounded independent pretrained model research run

Question: does original pretrained **TotalSegmentator cerebral_bleed**
independently propose hemorrhage in the exact real public NCCT previously
analyzed by pretrained **ianpan**? This is NOT a medical expert evaluation.

The real published PHE-SICH-CT-IDS NCCT is 512×512×25 (original NIfTI SHA256
`0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95`).
The original ianpan clinical-research output already exists byte-identically
in `web/public/examples/ianpan-ich-real-figshare-run-38734338486.json`.
Its 14 class/slice proposals comprise 7 intracerebral and 7 duplicated
general 'any' candidates across native source slices 10–16.

A new **one-off research workflow** on a GitHub-hosted CPU:
`.github/workflows/ich-totalseg-independent-public-once.yml`
runs only when this research branch first adds it. Its CPU job has a strict
18-minute upper bound; the actual model execution gets an independent
700-second timeout. Nothing is downloaded or computed on the owner's Mac.

The official TotalSegmentator v2.18.0 `cerebral_bleed` **task 150**
is openly listed under Apache-2.0, but the model has limited-domain
training and cannot claim clinical robustness. Checkpoint comes only
from the original publisher's GitHub asset
`Dataset150_icb_v0.zip` (325,569,459 bytes) at
`v2.0.0-weights`. Downloaded archive bytes are hashed, ZIP members
are safely checked then extracted to an isolated temporary model directory.
An archive SHA calculated during the workflow is evidence of exactly
which bytes were used; no independent signed upstream checkpoint digest
is provided. Any additional official skull-cropping model is retrieved
according to the pinned TotalSegmentator runtime.

The runner uses the exact same licensed public source NIfTI, refuses a
normalized or mismatched source, and executes actual original checkpoint
`TotalSegmentator --task cerebral_bleed --device cpu --ml`
without a fabricated inference shortcut. The post-run evaluator
`scripts/compare-ich-independent-totalseg.py` accepts only original
source-grid label values 0/1 and same physical NIfTI affine, and computes:

- how many ORIGINAL SOURCE voxels the second genuine model marked as
  candidate blood, and research-only source-voxel/physical volume;
- which ORIGINAL source axial CT slice indices contain second-model
  positive pixels;
- what fraction of **second-model segmentation pixels** lie in the
  union of **first-model native CT rectangular candidate envelopes**.

The first model's rectangles are not pixel-level segmentations, so
this is explicitly NOT blood-mask Dice, expert recall, diagnosis,
clinical sensitivity or a case-level true positive. The publisher's
reference masks are perihematomal **edema**, not true hematoma masks.
Agreement between two pretrained models is NOT independent radiologist
ground truth. A negative second-model mask cannot establish normal CT.

**Execution decision:** if download, source identity, native geometry,
CPU resource preflight, 700s inference timeout or official checkpoint
metadata fails, report the execution failure as 'no second-model result';
never substitute the first model's mask, reuse the first network's scores
or invent Dice/TP. This bounded research attempt must not delay further
clinical detector engineering. Raw medical pixels, derived segmentation
masks, checkpoint archives and IDs never enter Github git artifacts;
only numeric output is uploaded with 20-day retention.
