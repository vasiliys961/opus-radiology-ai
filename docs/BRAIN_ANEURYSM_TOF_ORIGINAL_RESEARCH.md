# Original TOF-MRA brain aneurysm pathology model — research-only

**New localization: intracranial aneurysm on 3D TOF MR angiography.** This
is **not** a brain anatomical-mask placeholder or CT brain-bleed detector.

* **True model:** official pretrained TotalSegmentator v2.18.0
  `brain_aneurysm` task (Task 615). Official checkpoint SHA actually observed
  on public Linux GitHub research run #39169526094:
  `529e222ce2b656173b65a1600a64c5bd5f22d1d030b9d7406e5ec4ecd0855f35`.
  That run downloaded real weights, but original forward **timed out**;
  therefore there is NO verified model result or Dice yet.
* **Public original positive study:** CC0 OpenNeuro `ds003949` TOF angiography,
  original git-annex commit `8921f7b9beab038e1a314f9aab84d7358c4568c5`,
  study `sub-013`, manual lesion mask and pinned source size/MD5.
* **Native evidence:** `scripts/real-openneuro-tof-aneurysm.py` downloads
  only the exact allowed reference pair, validates 3D TOF/full native affine,
  authenticates model/mask provenance, then computes TP/FP/FN and one-case Dice
  only when an ACTUAL nnU-Net prediction + documented preprocessing protocol
  and observed checkpoint manifest exist.
* **CPU research workflow:** `.github/workflows/real-openneuro-tof-brain-aneurysm.yml`
  keeps heavyweight real inference behind an explicit `workflow_dispatch`,
  rather than rerunning a previously timed-out >20-minute task on every merge.
  PR CI performs just the fail-closed case/model contract.
* **License:** official `brain_aneurysm` checkpoint is CC BY-NC 4.0,
  **research only, cannot be used in a commercial Opus product**. Only the
  separately licensable/free-use code and pipeline can be retained for future
  eligible models. In particular, do NOT add the official weights to default
  worker downloads, patients, remote LLMs or production deployments.
* The previous 2.0-mm whole-field research resampling can miss small
  aneurysms; source-volume preserved geometry does not make it clinically
  sensitive. No independent detection rate, false positive rate, negative
  MRA conclusion or physician clearance established.

Other missing locations remain important: pelvic fractures (FracSegNet),
prostate csPCa (PI-CAI), spinal myeloma (original VMI40), renal calculi on NCCT,
and pancreatic tumor (MONAI DiNTS). Fill original functional executors first.
