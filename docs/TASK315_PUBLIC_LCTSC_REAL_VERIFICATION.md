# Task315: real pretrained model verification on open TCIA LCTSC CT

This workflow is an explicit nonpatient technical research check of actual official
TotalSegmentator 2.18.0 task pleural_pericard_effusion, NOT just mock masks.

Provenance: TCIA LCTSC, Creative Commons Attribution 3.0. All 103 supplied
original DICOM slices are checked against the pinned per-slice public SHA-256
manifest and converted without image windowing/resampling to one 512x512x103
HU NIfTI. Exact expected original NIfTI SHA-256 is
99615ddb66e09bd46c2ff70c352d73414285145b358e448682b7cffc41249738.
All supplied original slices does NOT certify the complete anatomical chest.
This must remain disclosed with every output.

Official TotalSegmentator task 315 weights are downloaded in a standalone
provisioning step using the published totalseg_download_weights command. The
installed checkpoint file SHA-256 is independently measured and used for
admission, but this is NOT a publisher signature or cryptographic proof the
official internal engine selected that very fold/weight instance.

Pipeline:
1. Download original permitted anonymized public CT, with complete original
   frame hash/geometry check, before attempting pretrained model inference.
2. Pre-provision task315 actual checkpoint, verify package version 2.18.0,
   10 GiB free RAM and 8 GiB disk before beginning.
3. Run real totalsegmentator.python_api.totalsegmentator with task
   pleural_pericard_effusion, multilabel output and CPU device.
4. Validate native source-grid labels on all eight spatial corners and separate
   anatomical label 1 from pathological candidate labels 2/3.
5. Save only a bounded numeric SHA-bound research summary as a temporary GitHub
   Actions artifact. No public CT pixels, patient identifiers, derived masks,
   checkpoints or LLM provider tokens survive CI cleanup.

When the workflow fails, the medical model is NOT counted as successfully
benchmarked on this CT. Technical unit tests use simulated masks and never
substitute for successful true trained-model inference.

No pleural or pericardial expert mask for this public LCTSC scan has been
confirmed. Therefore Dice, sensitivity, specificity, FROC and positive or
negative clinical diagnoses are all unavailable. The original 103 slices
may be anatomically incomplete. Predicted zero fluid is never "no effusion".
Maintain patient cloud OFF and do not run the heavy model on Mac M1/8 GB.

Workflow: .github/workflows/real-task315-public-lctsc.yml.
