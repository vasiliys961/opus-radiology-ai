"""Memory-bounded 26-connected 3D components for original LungSCAPE masks.

Processes 2D slices, joining touching objects across consecutive slices. Unlike
scipy.ndimage.label on the entire 3D volume, does not allocate full 3D arrays.
Coordinates are source IJK; RAS-mm and mL only when source declares mm.
"""
from itertools import product

MAX_NODES = 150_000
MAX_PER_CLASS = 80
MIN_REPORT_VOXELS = 10

def inspect_streaming_components(source, prediction, label_map):
    import nibabel as nib
    import numpy as np
    from scipy.ndimage import label as label2d, find_objects
    src, seg = nib.load(str(source)), nib.load(str(prediction))
    if src.ndim != 3 or src.shape != seg.shape or not np.allclose(src.affine, seg.affine, atol=1e-4, rtol=0):
        raise ValueError("source/prediction physical grid mismatch")
    mm = src.header.get_xyzt_units()[0] == "mm"
    voxel_ml = abs(float(np.linalg.det(src.affine[:3, :3]))) / 1000 if mm else None
    results=[]; bylabel={}
    for cls in sorted(k for k in label_map if k):
        parents=[]; sizes=[]; lows=[]; highs=[]; sums=[]
        def find(i):
            while parents[i] != i:
                parents[i]=parents[parents[i]]
                i=parents[i]
            return i
        def union(a,b):
            a,b=find(a),find(b)
            if a==b:return
            if sizes[a]<sizes[b]:a,b=b,a
            parents[b]=a;sizes[a]+=sizes[b]
            lows[a]=[min(x,y) for x,y in zip(lows[a],lows[b])]
            highs[a]=[max(x,y) for x,y in zip(highs[a],highs[b])]
            sums[a]=[x+y for x,y in zip(sums[a],sums[b])]
        previous=None
        for z in range(src.shape[2]):
            plane=np.asarray(seg.dataobj[:,:,z])
            if not np.isfinite(plane).all() or not np.equal(plane,np.floor(plane)).all():
                raise ValueError("non-integer or nonfinite model labels")
            binary=(plane==cls)
            current,n=label2d(binary,structure=np.ones((3,3),dtype=np.uint8))
            if len(parents)+n>MAX_NODES:
                return {"componentAnalysisCompleted":False,
                        "componentAnalysisReason":"streaming_component_node_budget",
                        "candidateComponents":[],"clinicalValidation":False}
            ids=np.zeros(n+1,dtype=np.int32)
            if n:
                objects=find_objects(current)
                for local,slices in enumerate(objects,1):
                    if slices is None:continue
                    patch=current[slices]==local
                    ii,jj=np.nonzero(patch)
                    i0,j0=slices[0].start,slices[1].start
                    node=len(parents);ids[local]=node+1
                    count=int(ii.size)
                    parents.append(node);sizes.append(count)
                    lows.append([i0+int(ii.min()),j0+int(jj.min()),z])
                    highs.append([i0+int(ii.max()),j0+int(jj.max()),z])
                    sums.append([float(ii.sum()+count*i0),float(jj.sum()+count*j0),float(count*z)])
            nodes=ids[current] if n else np.zeros(current.shape,dtype=np.int32)
            if previous is not None and n:
                nx,ny=nodes.shape
                for di in (-1,0,1):
                    for dj in (-1,0,1):
                        # Padded shifted pairs preserve 26-neighbour adjacency.
                        x0=max(0,di);x1=min(nx,nx+di)
                        y0=max(0,dj);y1=min(ny,ny+dj)
                        older=previous[x0:x1,y0:y1]
                        newer=nodes[x0-di:x1-di,y0-dj:y1-dj]
                        keep=(older>0)&(newer>0)
                        if not np.any(keep):continue
                        pairs=np.unique(np.stack((older[keep],newer[keep]),axis=1),axis=0)
                        for old,new in pairs:
                            union(int(old)-1,int(new)-1)
            previous=nodes
        roots=[i for i,p in enumerate(parents) if find(i)==i]
        eligible=sorted((i for i in roots if sizes[i]>=MIN_REPORT_VOXELS),
                        key=lambda i:(-sizes[i],i))
        bylabel[str(cls)]={"allConnectedComponents":len(roots),
                          "atLeastMinimumVoxelCount":len(eligible),
                          "exportedComponents":min(len(eligible),MAX_PER_CLASS)}
        for idx in eligible[:MAX_PER_CLASS]:
            lo,hi=lows[idx],highs[idx]
            centroid=[s/sizes[idx] for s in sums[idx]]
            corners=np.array([[*p,1.] for p in product(*[(a,b) for a,b in zip(lo,hi)])])
            bounds=(src.affine@corners.T).T[:,:3] if mm else None
            actual=(src.affine@np.array([*centroid,1.]))[:3] if mm else None
            results.append({"originalModelLabelId":int(cls),"notDiagnosis":True,
                "connectivity":26,"voxels":int(sizes[idx]),
                "sourceVoxelBoundsInclusive":[lo,hi],
                "sourceVoxelComponentCentroid":[round(float(v),4) for v in centroid],
                "sourceRasMmComponentCentroid":[round(float(v),3) for v in actual] if mm else None,
                "sourceRasMmAxisAlignedBounds":[[round(float(v),3) for v in bounds.min(axis=0)],
                                                [round(float(v),3) for v in bounds.max(axis=0)]] if mm else None,
                "volumeMl":round(sizes[idx]*voxel_ml,4) if mm else None})
    return {"componentAnalysisCompleted":True,
            "componentAnalysisReason":"streaming_26_connected_original_mask",
            "candidateComponents":results,"componentsByOriginalLabel":bylabel,
            "minimumReportedComponentVoxels":MIN_REPORT_VOXELS,
            "unreportedTinyComponentsNotClinicalNegatives":True,
            "clinicalValidation":False}
