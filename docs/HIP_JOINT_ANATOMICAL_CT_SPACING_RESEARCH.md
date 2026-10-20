# Hip joints — physical CT bone-mask separation in user-defined joint ROI

New functional *research-only* computation, not a hip osteoarthritis/AVN detector.
Uses **two real externally segmented anatomical masks** from the
TotalSegmentator 2.18.0 `total` CT task, `femur_left/right` and
`hip_left/right` (publisher label ontology verified against original
v2.18.0 `totalsegmentator/map_to_binary.py`). These refer to proximal femur
and hip/pelvic bone, not cartilage, capsule, or femoral-head necrosis.

Researcher/physician selects one anatomical joint ROI in ORIGINAL NIfTI
voxel coordinates for one hip, `x0:x1,y0:y1,z0:z1`. The function reads
the original CT and corresponding real 3D binary bone masks on exact
same physical affine, proves there is no mask overlap, and calculates
the numerical minimum/P10/median/P90 3D physical nearest-surface
separation between the segmented femur and hipbone **within that ROI**.
The ROI is explicitly limited to a single proximal femoral head/
acetabular region by the investigator; no auto-location or
pathology-specific trained inference is claimed.

    python3 scripts/real-hip-joint-native-ct-anatomy-gap.py \
      --ct /public/original_licensed_ct.nii.gz \
      --ct-sha256 <actual_original_CT_SHA256> \
      --hip-mask /trained/hip_left.nii.gz \
      --hip-mask-sha256 <actual_mask_SHA256> \
      --femur-mask /trained/femur_left.nii.gz \
      --femur-mask-sha256 <actual_mask_SHA256> \
      --side left --roi 120:240,100:230,35:105 \
      --public-source-url https://actual-licensed-research-CT \
      --public-source-license 'verified original imaging rights' \
      --approved-public-research --output /isolated/new_hip_measurements.json

**Important:** This is not an accepted radiographic joint-space width:
a 3D shortest surface distance can be dominated by segmentation,
cortical/partial-volume artefacts, bony impingement, or a clipped manually
drawn ROI. It does not measure cartilage thickness, joint cartilage loss,
hip labrum, synovitis, AVN, or alpha angle. No coxarthrosis, dysplasia,
AVN, osteophyte or fracture diagnoses, no clinical thresholds.
Full source-frame DICOM navigation, reproducibility across hip CT protocols
and independent physician caliper validation must be established before
clinical use. An absent or non-overlapping ROI is an error, not a normal joint.

CI tests only known synthetic source-native 3D affine and refusal conditions.
The masks must originate from a real externally performed permitted
pretrained anatomy inference, with independently tracked provenance.
No patient/cloud/LLM upload and no GPU or training performed here.
