"""Reversible ICH model-window ROI → source HU NIfTI geometry (research only).

Vendor e6d89c2 read_nifti_volume: nibabel reorient to LPS and transpose
(2,1,0), before window_hu_slice center crop/pad to 512x512. We invert
THOSE EXACT geometry operations; no probabilistic registration, untrusted
DICOM UID inference, interpolation, or claim of confirmed lesion.
"""
from __future__ import annotations

import math


def map_ich_model_regions_to_nifti(image, predictions):
    """Add NIfTI source ROI bounds to genuinely produced 2D heatmap proposals.

    Returns research-only candidates with optional sourceVoxelProjection.
    A missing 0.5 heatmap ROI never becomes a false anatomical region.
    This does not verify the HU provenance or the clinical accuracy of a box.
    """
    import numpy as np
    import nibabel as nib

    if len(image.shape) != 3:
        raise ValueError("source_projection_requires_3d_nii")
    source_affine = np.asarray(image.affine, dtype=np.float64)
    if source_affine.shape != (4,4) or not np.isfinite(source_affine).all():
        raise ValueError("source_projection_invalid_affine")
    native_ornt = nib.orientations.io_orientation(source_affine)
    if np.isnan(native_ornt).any():
        raise ValueError("source_projection_ambiguous_orientation")
    lps_ornt = nib.orientations.axcodes2ornt(("L","P","S"))
    reorder = nib.orientations.ornt_transform(native_ornt, lps_ornt)
    dims = np.asarray(image.shape, dtype=int)
    lps_dims = dims[np.argsort(reorder[:,0].astype(int))]
    lps_width,lps_height,lps_depth = map(int,lps_dims)
    if (min(lps_dims)<8 or max(lps_dims)>512 or
        not np.isfinite(lps_dims).all()):
        raise ValueError("source_projection_image_out_of_bounds")
    inverse_orientation = nib.orientations.inv_ornt_aff(reorder, tuple(dims))
    pad_left=(512-lps_width)//2
    pad_top=(512-lps_height)//2
    xmin_valid,xmax_valid=pad_left,pad_left+lps_width-1
    ymin_valid,ymax_valid=pad_top,pad_top+lps_height-1
    output=[]
    for candidate in predictions:
        c=dict(candidate)
        box=c.get("modelInputBoundingBoxXY")
        if box is None:
            c["sourceVoxelProjection"]=None
            output.append(c)
            continue
        if (not isinstance(box,list) or len(box)!=4 or
            any(type(v) is not int or v<0 or v>511 for v in box) or
            box[0]>box[2] or box[1]>box[3]):
            raise ValueError("invalid_model_heatmap_box_for_projection")
        z=c.get("sliceIndexModelOrdered")
        if type(z) is not int or not 0<=z<lps_depth:
            raise ValueError("source_projection_slice_out_of_range")
        x0=max(box[0],xmin_valid)
        y0=max(box[1],ymin_valid)
        x1=min(box[2],xmax_valid)
        y1=min(box[3],ymax_valid)
        if x0>x1 or y0>y1:
            # Heatmap exists only in zero-padded model pixels.
            c["sourceVoxelProjection"]=None
            output.append(c)
            continue
        model_xy=[
            [x0-pad_left,y0-pad_top],
            [x1-pad_left,y0-pad_top],
            [x0-pad_left,y1-pad_top],
            [x1-pad_left,y1-pad_top],
        ]
        points_native=[]
        points_ras=[]
        for xx,yy in model_xy:
            native=inverse_orientation @ np.array([xx,yy,z,1.],dtype=float)
            if (not np.allclose(native[:3],np.round(native[:3]),atol=1e-6)
                or any(v<0 or v>=dims[i] for i,v in enumerate(native[:3]))):
                raise ValueError("inverse_nifti_orientation_out_of_bounds")
            world=source_affine @ native
            if not np.isfinite(world).all():
                raise ValueError("invalid_source_world_projection")
            points_native.append(np.round(native[:3]).astype(int))
            points_ras.append(world[:3])
        vox=np.stack(points_native)
        ras=np.stack(points_ras)
        bbox_native=vox.min(axis=0).tolist()+vox.max(axis=0).tolist()
        bbox_world=[round(float(v),3) for v in
                    list(ras.min(axis=0))+list(ras.max(axis=0))]
        c["sourceVoxelProjection"]={
            "boundingBoxNativeNiftiXYZ":bbox_native,
            "boundingBoxWorldRasMm":bbox_world,
            "projectionMethod":"vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1",
            "trimmedOutsideOriginalCT":bool(
                x0!=box[0] or x1!=box[2] or y0!=box[1] or y1!=box[3]),
            "independentlyClinicallyVerified":False,
            "expertMaskCompared":False,
        }
        output.append(c)
    return output
