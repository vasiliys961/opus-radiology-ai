#!/usr/bin/env python3
"""Safety contract for exact-source LungSCAPE connected component records."""
import copy
from lungscape191_physician_candidates import assemble
base={
 "schema":"opus-lungscape191-authentic-public-ct-forward/v1",
 "realOriginalTrainedForward":True,"verifiedNativeGrid":True,
 "independentValidation":False,"expertDiceComputed":False,
 "ggoHoneycombingUIPNSIPSubtypeClassification":False,"clinicalUsePermitted":False,
 "sourcePixelsOrMasksIncludedInArtifact":False,
 "sourceSha256":"a"*64,"originalPredictionSha256":"b"*64,"publicResearchCase":"coronacases_003",
 "originalModelLabelMap":{"0":"background","1":"high attenuation"},
 "observedNonbackgroundModelVoxels":31,
 "originalModelRegionsNotClinicalDiagnoses":[{
   "originalModelLabelId":1,"voxels":31,"sourceVoxelBoundsInclusive":[[0,0,0],[7,7,4]],
   "volumeMl":None,"sourceRasMmAxisAlignedBounds":None}],
 "originalMaskComponentAnalysisCompleted":True,
 "originalMaskConnectedComponentsResearchOnly":[
   {"originalModelLabelId":1,"voxels":13,"notDiagnosis":True,"connectivity":26,
    "sourceVoxelBoundsInclusive":[[0,0,0],[2,2,3]],"volumeMl":None,
    "sourceVoxelComponentCentroid":[1.,1.,1.]},
   {"originalModelLabelId":1,"voxels":18,"notDiagnosis":True,"connectivity":26,
    "sourceVoxelBoundsInclusive":[[5,5,0],[7,7,1]],"volumeMl":None,
    "sourceVoxelComponentCentroid":[6.,6.,.5]}
 ]}
result=assemble(base)
assert len(result["individualMaskComponents"])==2
assert all(c["clinicalDiagnosis"] is None and c["volumeMlOnlyWhenOriginalUnitsVerified"] is None
           for c in result["individualMaskComponents"])
for key,value in (("voxels",32),("sourceVoxelBoundsInclusive",[[0,0,0],[8,8,4]]),
                  ("connectivity",6),("notDiagnosis",False)):
    invalid=copy.deepcopy(base)
    invalid["originalMaskConnectedComponentsResearchOnly"][0][key]=value
    try:assemble(invalid)
    except ValueError:pass
    else:raise AssertionError("tampered component accepted: "+key)
legacy=copy.deepcopy(base)
legacy.pop("originalMaskConnectedComponentsResearchOnly")
legacy["originalMaskComponentAnalysisCompleted"]=False
assert assemble(legacy)["individualMaskComponents"]==[]
print("PASS: original 3D components are source-bound and never falsely clinical")
