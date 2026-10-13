# Bounded NIfTI CT source review for public MSD abdomen (PR #76)

**Scope:** local input **3 files** at \`/viewer\` → "NIfTI · КТ брюшной полости":
1. **Original source** uncompressed, native CT float32/int16 NIfTI-1 \`.nii\`
   (e.g. \`public_abdomen_ct.nii\` from the existing vetted
   \`scripts/prepare-msd-spleen-abdomen.py\`).
2. Research mask \`.nii\` with **32 original contiguous slices** extracted by
   \`scripts/extract-totalseg-mpr-slab.py --research-profile abdomen-four-organs\`.
3. Matching \`opus-totalseg-abdomen-native-mpr-slab/v1\` \`.json\` manifest.

Uses **the existing** native mask parser, anatomical name registry, occupied
voxel navigation, and physical geometry checks. The source NIfTI is NOT
converted into fake DICOM. The full source is **incrementally hashed** against
the research manifest without decoding into RAM; only the same original
32-slice float32/int16 slab is opened via \`Blob.slice()\`. Hard caps: source
128 MiB, slab <=8,388,608 voxels / <=32 slices, mask <= existing 32 MiB.
Any source SHA, label count, mismatched native affine, voxel index reversal,
unsupported NIfTI orientation, or unsupported units fails closed.

Native CT planes \`i/j/k\` are **voxel-index planes, not automatically
anatomical axial/coronal/sagittal**. They are rendered with scalar window
controls and nearest-neighbour research labels, using no network or new model.
All four organs can be highlighted/jumped to an occupied mask voxel.
An anatomical structure's measured volume is **partial mask volume**
and missing labels do not mean the organ is absent or healthy.

The original public MSD Task09 CT is stored and verified in the *ephemeral*
GitHub Actions runner, then wiped. This PR does not publish or recreate the
medical data in GitHub and does not claim that the user already has all
three local files; they must be prepared and legally obtained separately.
The already measured \`0.947923\` spleen Dice applies to one original
public **training** CT only, not arbitrary uploaded CT sources.

**Verification still required:** real browser using legally available source
NIfTI+matched full-trained mask; Safari/M1 peak memory; orientation against
an external anatomy reference; broad clinical validation. This code enables
research **image review**, NOT automatic clinical diagnosis.
