# KiTS23 original CT + manual positive renal tumor — genuine source admission

**Important:** Original KiTS23 manually annotated renal tumor label **2** is **not** kidney anatomy label 1 and **not** renal cyst label 3.

Public repository: [MedOtter/kits23](https://huggingface.co/datasets/MedOtter/kits23) at exact original public LFS mirror revision `3ddf82e740fbf40f5ca609762be4ba426335d8e7`. It advertises **CC BY-NC-SA 4.0**: legal use is *noncommercial research with attribution and share-alike*, not automatically authorized patient or commercial use. Original upstream KiTS23 study rights and training overlap of PanCancerSeg must be separately checked before clinical use/accuracy claims.

**Genuine expert-positive case:** `dataset/case_00021/imaging.nii.gz`, original Git LFS SHA256 `e6377e6d073e7fb49e3b14c845165322b60a062d45506f258b162a5719810961`, and corresponding original `dataset/case_00021/segmentation.nii.gz`, Git LFS SHA256 `8e79ea88a9a0abd0c271b6826ab917431c20d45d4da907eae83b46eaef7449bf`. Both original full files are downloaded and hashed by `scripts/admit-real-public-kits23-kidney-tumor.py`; local private source exact bytes and expert original binary labels must have a matching real NIfTI affine and shape. This is a **positive pathology study** only after label 2 voxel count is observed; label1 kidney and label3 cyst are reported separately.

The source-bound report records native original voxel bounds, original source SHA, expert tumor voxels, millilitre volume and RAS-mm centroid **only if physical millimetres are declared in original NIfTI**. It records source CT HU observed range, no patient metadata or source image pixels. The user Mac M1 is not involved. All original scans/masks stay under the isolated GitHub Actions runner temp directory and are deleted; artifact holds **only aggregate numbers**.

### Evidence level / next gate

This public CT admission is **not model inference**, not independent clinical validation, and not confirmation that the KiTS23 subject did not overlap the publisher model training. Model target is kidney cancer; an expert class 2 annotation must **never be fed into model input**. Later compare independently obtained output `Dataset102_Kidney` original checkpoint SHA `5a1c9e2894160d50dfa0f8c0ac0a88198897973f642c0cbeb33e935457fd9d8c` to the unchanged original CT and expert, then calculate real TP/FP/FN Dice, lesion recall and false detections. If the 64GiB worker is not available, do not claim a forward; add other pathological models independently.

Only when `.github/workflows/kits23-public-renal-cancer-original.yml` successfully downloads and verifies source bytes and positive expert label 2 should it be called an original real **public expert-positive KiTS23 CT available**. Its offline unit tests are not enough to establish that claim.
