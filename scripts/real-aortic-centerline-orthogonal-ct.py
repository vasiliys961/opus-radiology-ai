#!/usr/bin/env python3
"""Original NIfTI CT aorta-mask centerline-perpendicular morphology (research).

Actual source-native 3D geometry on a separately generated anatomical aorta
mask; not external-wall AAA imaging, not stenosis/dissection/aneurysm detection.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

MAX_BYTES=750*1024**2
MAX_VOXELS=110_000_000


def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for c in iter(lambda:f.read(1024*1024),b""):
            h.update(c)
    return h.hexdigest()


def read_nifti(path):
    import numpy as np
    import nibabel as nib
    path=Path(path)
    if path.is_symlink() or not path.is_file() or not 256<=path.stat().st_size<=MAX_BYTES:
        raise ValueError("unbounded_or_missing_original_NIfTI")
    image=nib.load(str(path))
    a=image.affine
    if len(image.shape)!=3 or np.prod(image.shape,dtype=np.int64)>MAX_VOXELS:
        raise ValueError("unbounded_original_source_volume")
    mm=np.linalg.norm(a[:3,:3],axis=0)
    if (not np.isfinite(a).all() or not np.allclose(a[3],[0,0,0,1])
            or np.any(mm<.3) or np.any(mm>5)
            or abs(np.linalg.det(a[:3,:3]))<.02):
        raise ValueError("invalid_native_physical_CT_affine")
    vectors=a[:3,:3]/mm
    if max(abs(float(np.dot(vectors[:,x],vectors[:,y])))
           for x,y in ((0,1),(0,2),(1,2)))>.03:
        raise ValueError("sheared_CT_requires_separate_anatomical_analysis")
    return image


def orthogonal_profile(ct_file,mask_file,step_mm=1.0):
    import numpy as np
    from scipy.ndimage import map_coordinates,median_filter,binary_erosion
    from scipy.spatial import ConvexHull
    from scipy.spatial.distance import pdist
    if not 0.75<=step_mm<=2.0:
        raise ValueError("unsafe_plane_sampling_resolution")
    ct=read_nifti(ct_file)
    seg=read_nifti(mask_file)
    if seg.shape!=ct.shape or not np.allclose(seg.affine,ct.affine,atol=.02,rtol=0):
        raise ValueError("aorta_mask_not_source_NIfTI_geometry")
    if seg.get_data_dtype().kind not in "biu":
        raise ValueError("aorta_mask_not_original_binary_integer")
    vox=np.asarray(seg.dataobj,dtype=np.uint8)
    if not np.isin(vox,(0,1)).all():
        raise ValueError("aorta_anatomical_mask_not_binary")
    if int(np.count_nonzero(vox))<500:
        raise ValueError("aorta_mask_absent_or_too_short")
    source_a=ct.affine
    center=[]
    for k in range(vox.shape[2]):
        ij=np.argwhere(vox[:,:,k]>0)
        if len(ij)>=30:
            v=np.r_[ij.mean(axis=0),k,1.]
            center.append((k,(source_a@v)[:3]))
    if len(center)<15 or max(center[i+1][0]-center[i][0] for i in range(len(center)-1))>4:
        raise ValueError("aorta_not_sufficiently_contiguous_for_centerline")
    # Smooth the measured centerline before local tangent calculation.
    ks=np.array([x[0] for x in center],dtype=int)
    line=np.array([x[1] for x in center],dtype=float)
    line=np.stack([median_filter(line[:,axis],size=5,mode="nearest")
                   for axis in range(3)],axis=1)
    if np.any(np.linalg.norm(np.diff(line,axis=0),axis=1)>12):
        raise ValueError("aorta_centerline_discontinuity")
    sample_idx=list(range(4,len(ks)-4,max(1,len(ks)//45)))
    inv=np.linalg.inv(source_a)
    radius=55.0
    offsets=np.arange(-radius,radius+step_mm*.5,step_mm)
    u_grid,v_grid=np.meshgrid(offsets,offsets,indexing="ij")
    measurements=[]
    for idx in sample_idx:
        # Finite difference tangent estimates centerline, not simply z axis.
        tangent=line[idx+3]-line[idx-3]
        n=np.linalg.norm(tangent)
        if n<1:
            continue
        tangent=tangent/n
        reference=np.array([1.,0,0])
        if abs(float(reference@tangent))>.9:
            reference=np.array([0.,1.,0])
        axis_u=reference-(reference@tangent)*tangent
        axis_u/=np.linalg.norm(axis_u)
        axis_v=np.cross(tangent,axis_u)
        # World RAS samples on centerline-orthogonal plane, nearest label voxels.
        world=(line[idx,None,None,:]+
               u_grid[...,None]*axis_u+v_grid[...,None]*axis_v)
        flat=world.reshape((-1,3))
        source_points=(inv[:3,:3]@flat.T+inv[:3,3:4]).reshape(3,*u_grid.shape)
        binary=map_coordinates(vox,source_points,order=0,mode="constant",cval=0,
                               prefilter=False)>0
        if int(binary.sum())<30:
            continue
        # A clipped cross-section cannot be called a reliable maximal calibre.
        if np.any(binary[[0,-1],:]) or np.any(binary[:,[0,-1]]):
            continue
        area=float(binary.sum()*step_mm**2)
        boundary=binary&~binary_erosion(binary)
        pts=np.argwhere(boundary).astype(float)*step_mm
        if len(pts)<4:
            continue
        try:
            hull=ConvexHull(pts)
            diameter=float(pdist(pts[hull.vertices]).max())
        except Exception:
            continue
        if diameter<=0 or diameter>120:
            continue
        measurements.append({
          "originalSourceSliceIndex":int(ks[idx]),
          "centerlineRasMm":[round(float(x),3) for x in line[idx]],
          "planeNormalRas":[round(float(x),6) for x in tangent],
          "maskCrossSectionAreaMm2":round(area,2),
          "areaEquivalentDiameterMm":round(2*np.sqrt(area/np.pi),2),
          "sampledBinaryMaskMaxFeretMm":round(diameter,2),
          "samplingResolutionMm":step_mm})
    if len(measurements)<5:
        raise ValueError("insufficient_unclipped_centerline_orthogonal_cross_sections")
    mx=max(measurements,key=lambda x:x["sampledBinaryMaskMaxFeretMm"])
    return {"schema":"opus-aortic-centerline-orthogonal-anatomy-candidates/v1",
            "sourceCTSHA256":digest(ct_file),"aortaMaskSHA256":digest(mask_file),
            "sourceGridCoordinatesAreNativeNiftiRas":True,
            "numberOfReviewedOrthogonalPlanes":len(measurements),
            "maximumSampledMaskFeretMm":mx["sampledBinaryMaskMaxFeretMm"],
            "maximumSampledMaskAreaEquivalentDiameterMm":
                max(m["areaEquivalentDiameterMm"] for m in measurements),
            "maxPlaneOriginalSourceSlice":mx["originalSourceSliceIndex"],
            "orthogonalProfile":measurements,
            "measurementsAreInteriorSegmentationNotExternalWallCalipers":True,
            "noAneurysmOrAorticDiseaseDiagnosis":True,
            "noOriginalDicomSopMapping":True,
            "genuineModelForwardPerformedByThisScript":False,
            "clinicallyValidated":False,"patientCloudTransfer":False}


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--ct",type=Path,required=True)
    p.add_argument("--ct-sha256",required=True)
    p.add_argument("--aorta-mask",type=Path,required=True)
    p.add_argument("--aorta-mask-sha256",required=True)
    p.add_argument("--sample-resolution-mm",type=float,default=1.0)
    p.add_argument("--public-source-url",required=True)
    p.add_argument("--public-source-license",required=True)
    p.add_argument("--approved-public-research",action="store_true")
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    if (not a.approved_public_research or not a.public_source_url.startswith("https://")
            or not a.public_source_license.strip()):
        p.error("public_deidentified_licensed_study_required")
    for f,h in ((a.ct,a.ct_sha256),(a.aorta_mask,a.aorta_mask_sha256)):
        if len(h)!=64 or digest(f)!=h.lower():
            p.error("source_or_original_anatomy_SHA256_not_matched")
    result=orthogonal_profile(a.ct,a.aorta_mask,a.sample_resolution_mm)
    result["publicStudyURL"]=a.public_source_url
    result["researchLicense"]=a.public_source_license
    if a.output.is_symlink() or a.output.exists():
        p.error("numerical_report_must_be_new")
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"maxOrthogonalMaskFeretMm":result["maximumSampledMaskFeretMm"],
                      "numberOfPlanes":result["numberOfReviewedOrthogonalPlanes"],
                      "genuineModelForward":False,"clinicalDiagnosis":False}))


if __name__=="__main__":
    main()
