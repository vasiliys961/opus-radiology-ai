# Hepatic focal CT lesions — original pretrained pathology task

New functional pathology field: original TotalSegmentator `liver_lesions`
rather than a normal liver-anatomy mask. The source-bound research script
`scripts/real-public-msd-liver-lesions.py` accepts a real pretrained
binary output and original MSD Task03 CT/expert tumor reference, confirms
original geometry, and computes real TP/FP/FN/Dice only after the vendor
model mask and official checkpoint SHA manifest have been supplied.

The detector now emits **distinct focal candidate components** in the
original NIfTI volume (source voxel box, centroid, world-mm coordinate,
candidate ml volume). This is not DICOM SOP mapping or malignancy
classification. An empty model mask is never a negative cancer result.

`.github/workflows/real-public-msd-liver-lesions.yml` supplies a full
original pretrained CPU research forward as **explicit workflow_dispatch**
on an eligible isolated host; normal PR/main checks exercise only inexpensive
geometry/source contracts. The full workflow was never equated to a clinical
outcome: liver_lesions task and expert MSD label-2 tumor have overlapping
but non-identical target semantics, one source CT may overlap training, and
diagnostic sensitivity remains unestablished. No patient data/cloud LLM,
original images or model weights in GitHub artifacts.

Source: https://github.com/wasserth/TotalSegmentator
Public expert CT: https://huggingface.co/datasets/MedOtter/msd-liver

Focus remains adding pathology-specific models in other areas before
fine-tuning an already covered site.
