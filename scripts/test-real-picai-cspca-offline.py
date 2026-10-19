#!/usr/bin/env python3
"""Synthetic voxel and Docker security contracts; NO pretrained model inferred."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
import numpy as np

p=Path(__file__).with_name("real-picai-cspca-offline.py")
spec=importlib.util.spec_from_file_location("opus_picai",p)
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

class TestPICAIResearchContract(unittest.TestCase):
    def parameters(self):
        return dict(spacing_xyz=(.5,.5,3),origin_lps=(10,20,30),
                    direction_matrix=np.eye(3))

    def test_lesion_native_T2_coordinate_RAS(self):
        arr=np.zeros((20,32,32),dtype=np.float32)
        arr[5:8,10:13,20:24]=.74
        found=app.candidates(arr,**self.parameters())
        self.assertEqual(len(found),1)
        self.assertEqual(found[0]["originalT2VoxelBoundingBoxZYX"],[[5,7],[10,12],[20,23]])
        self.assertEqual(found[0]["originalT2CentroidIndexXYZ"],[21.5,11,6])
        self.assertEqual(found[0]["originalT2CentroidWorldRASmm"],[-20.75,-25.5,48])
        self.assertEqual(found[0]["candidateVoxels"],36)
        self.assertEqual(found[0]["candidateVolumeMm3"],27)
        self.assertFalse(found[0]["confirmedCancer"])

    def test_no_map_components_does_not_make_cancer_exclusion(self):
        a=np.zeros((10,10,10),dtype=np.float32)
        self.assertEqual(app.candidates(a,**self.parameters()),[])

    def test_invalid_nan_out_of_range_prediction_refused(self):
        a=np.zeros((10,10,10),dtype=np.float32)
        a[0,0,0]=float("nan")
        with self.assertRaisesRegex(ValueError,"vendor_detection_map_invalid"):
            app.candidates(a,**self.parameters())
        a[0,0,0]=1.01
        with self.assertRaisesRegex(ValueError,"vendor_detection_map_invalid"):
            app.candidates(a,**self.parameters())

    def test_reject_unpinned_container_and_no_network(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d)
            scans=[directory/name for name in ("t2.mha","adc.mha","hbv.mha")]
            for p in scans:p.write_bytes(b"technical placeholder")
            with self.assertRaisesRegex(ValueError,"SHA256"):
                app.docker_command("unstable:latest",*scans,directory)
            cmd=app.docker_command("sha256:"+"a"*64,*scans,directory)
            self.assertIn("--network",cmd)
            self.assertIn("none",cmd)
            self.assertIn("--read-only",cmd)
            self.assertIn("--cap-drop=ALL",cmd)
            self.assertIn("--security-opt=no-new-privileges",cmd)
            self.assertEqual(sum(v.count(",readonly") for v in cmd),3)
            self.assertEqual(cmd[-1],"sha256:"+"a"*64)

    def test_reject_same_FOV_center_mismatch(self):
        class Image:
            def __init__(self,origin): self.origin=origin
            def GetSize(self):return (32,32,20)
            def GetSpacing(self):return (1.,1.,2.)
            def GetDirection(self):return tuple(np.eye(3).ravel())
            def GetOrigin(self):return self.origin
        app.check_geometry([Image((0,0,0))]*3)
        with self.assertRaisesRegex(ValueError,"coverage_centers_not_aligned"):
            app.check_geometry([Image((0,0,0)),Image((0,70,0)),Image((0,0,0))])

    def test_patient_status_remains_explicitly_research_only(self):
        code=p.read_text()
        self.assertIn('"patientUseAllowed":False',code)
        self.assertIn('"originalTrainedWeightsIndependentlyVerified":False',code)
        self.assertNotIn('\"PatientName\"',code)

if __name__=="__main__":unittest.main()
