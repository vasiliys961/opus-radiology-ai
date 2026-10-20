# Exact publisher pretrained weight byte proof (lung and renal CT)

**Scope**: native public author-trained model *asset verification*, not GPU/CPU inference or clinical validation.

This workflow downloads the original binary `fold_0/checkpoint_best.pth` + original `dataset.json` and `plans.json` from [KS987/PanCancerSeg-Specialized-weights](https://huggingface.co/KS987/PanCancerSeg-Specialized-weights), at a **resolved immutable 40-character source revision**. It computes the actual SHA256 of the downloaded checkpoint and metadata, verifies the correct author trainer/configuration and binary oncology ontology (0 background, 1 lesion) **without deserializing untrusted PyTorch pickle checkpoints**. Separate jobs confirm `Dataset105_Lung` and `Dataset102_Kidney`. The model card advertises Apache2 weights; sample CT, training data, and patient-use permissions remain a separate question.

Run `ks987-public-original-weight-audit.yml` on a public-only GitHub runner with **no patient studies whatsoever**. The only upload is a numerical SHA256/byte-size manifest. Model weights remain in the runner cache and are never committed or uploaded as artifacts. No application downloads weights automatically. User's Mac M1 is not involved.

**Acceptance criteria:** workflow completes, pinned original model revision and two distinct checkpoint SHA256s appear in machine-readable artifacts. This is `asset verified`, **not** `real pretrained forward` and not Dice/lesion sensitivity or deployable cancer diagnosis. A green contract CI without a genuine checkpoint download is not enough.

When source/model version changes, the SHA must be reverified before use. Forward still requires the separate `pancancer_lung_kidney_research.py` executor on >=64GiB free RAM Linux research worker and an exact original, lawful CT whose training overlap is examined.
