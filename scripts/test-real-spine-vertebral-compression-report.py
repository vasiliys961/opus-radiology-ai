#!/usr/bin/env python3
"""Research contract only. All fixtures here are technical, not pretrained evidence."""
import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path

HERE=Path(__file__).parent/"real-spine-vertebral-compression-report.py"
spec=importlib.util.spec_from_file_location("opus_spine_original_report",HERE)
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

class TestRealSpineReportContract(unittest.TestCase):
    def meta(self):
        return {"license":"CC BY 3.0","url":"https://www.cancerimagingarchive.net/collection/lctsc/"}

    def bboxes(self):
        return {"vertebrae_L1":[[1,7],[8,12],[20,25]]}

    def test_named_original_lumbar_height_measurement(self):
        real_like_report={"results":{
            "vertebrae_L1_height_difference":0.27,
            "vertebrae_L1_intensity_median":145.0,
            "PatientName":"NEVER_PASS_THROUGH",
        },"metadata":{"PatientID":"NEVER_PASS_THROUGH"}}
        got=app.parse_report(real_like_report,self.bboxes(),"a"*64,self.meta(),"b"*64,"c"*64)
        self.assertEqual(got["heightLossOver20PctCandidates"],["L1"])
        self.assertEqual(got["vertebrae"][0]["sourceVoxelBox"],[[1,7],[8,12],[20,25]])
        self.assertIsNone(got["expertDiseaseAccuracy"])
        self.assertFalse(got["patientUseAllowed"])
        self.assertNotIn("NEVER_PASS_THROUGH",json.dumps(got))

    def test_missing_original_spine_evidence_is_not_negative(self):
        with self.assertRaisesRegex(ValueError,"no_original_model_vertebral"):
            app.parse_report({"results":{}},{},"a"*64,self.meta(),"b"*64,"c"*64)

    def test_invalid_nonfinite_height_refused(self):
        for v in (float("nan"),float("inf"),"NaN",2.0,-1.0):
            with self.subTest(v=v):
                with self.assertRaises(ValueError):
                    app.parse_report({"results":{"vertebrae_L1_height_difference":v}},
                                     self.bboxes(),"a"*64,self.meta(),"b"*64,"c"*64)

    def test_missing_height_never_implies_normal(self):
        got=app.parse_report({"results":{"vertebrae_L1_intensity_median":120.0}},
                             self.bboxes(),"a"*64,self.meta(),"b"*64,"c"*64)
        self.assertEqual(got["heightLossOver20PctCandidates"],[])
        self.assertIsNone(got["vertebrae"][0]["heightDifferenceFraction"])

    def test_threshold_strictly_greater_than_20_percent(self):
        got=app.parse_report({"results":{"vertebrae_L1_height_difference":0.2}},
                             self.bboxes(),"a"*64,self.meta(),"b"*64,"c"*64)
        self.assertEqual(got["heightLossOver20PctCandidates"],[])

    def test_no_model_is_not_silent_success(self):
        with self.assertRaises(ValueError):
            app.parse_report({"metadata":{}},self.bboxes(),"a"*64,self.meta(),"b"*64,"c"*64)

if __name__=="__main__":
    unittest.main()
