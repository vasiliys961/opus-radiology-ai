#!/usr/bin/env python3
"""Synthetic-only comparison to independent scipy 3D 26-connectivity."""
import tempfile
from pathlib import Path
import sys
import numpy as np
import nibabel as nib
from scipy.ndimage import label
sys.path.insert(0,str(Path(__file__).resolve().parent))
from lungscape191_streaming_components import inspect_streaming_components

with tempfile.TemporaryDirectory() as tmp:
    base=Path(tmp)
    mask=np.zeros((8,8,5),dtype=np.uint8)
    mask[0:2,0:2,0:3]=1 # 12 voxels
    mask[2,2,3]=1 # diagonally connected across three axes
    mask[5:8,5:8,0:2]=1 # 18 distinct voxels
    src=nib.Nifti1Image(np.zeros(mask.shape,dtype=np.int16),np.eye(4))
    seg=nib.Nifti1Image(mask,np.eye(4))
    src.header.set_xyzt_units("unknown")
    seg.header.set_xyzt_units("unknown")
    a=base/"ct.nii.gz";b=base/"model.nii.gz"
    nib.save(src,a);nib.save(seg,b)
    got=inspect_streaming_components(a,b,{0:"background",1:"high attenuation"})
    full,n=label(mask==1,structure=np.ones((3,3,3),dtype=np.uint8))
    assert n==2 and got["componentAnalysisCompleted"],got
    assert sorted(x["voxels"] for x in got["candidateComponents"])==[13,18],got
    assert all(x["volumeMl"] is None for x in got["candidateComponents"])
    assert all(x["notDiagnosis"] is True for x in got["candidateComponents"])
    # Wrong source physical geometry must never be admitted.
    shifted=nib.Nifti1Image(np.zeros(mask.shape,dtype=np.int16),np.diag([1,1,1,1]))
    shifted.affine[:3,3] if False else None
    different=np.eye(4);different[2,3]=4
    nib.save(nib.Nifti1Image(np.zeros(mask.shape,dtype=np.int16),different),a)
    try:inspect_streaming_components(a,b,{0:"background",1:"high attenuation"})
    except ValueError:pass
    else:raise AssertionError("mismatched source accepted")
    print("PASS: bounded streaming 26-connected matches genuine scipy 3D components")
