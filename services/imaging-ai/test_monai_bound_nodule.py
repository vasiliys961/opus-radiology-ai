"""Technical contract only: no medical weights, no patient CT or GPU."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[2]/"services/imaging-ai/monai_bound_nodule.py"
spec=importlib.util.spec_from_file_location("opus_monai_bound",SCRIPT)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def nifti(path,wrong=False):
    header=bytearray(352)
    struct.pack_into("<i",header,0,348)
    struct.pack_into("<h",header,40,3)
    struct.pack_into("<7h",header,42,16,16,8,1,1,1,1)
    struct.pack_into("<hh",header,70,4,16)
    struct.pack_into("<f",header,108,352.0)
    header[123]=2
    struct.pack_into("<h",header,254,1)
    # Original sform is RAS; output MHD source must be LPS.
    for row,values in enumerate([[-0.8,0,0,140],[0,-0.8,0,100],[0,0,2.5,-200]]):
        struct.pack_into("<4f",header,280+row*16,*values)
    if wrong:
        struct.pack_into("<f",header,108,354)
    header[344:348]=b"n+1\x00"
    path.write_bytes(header+struct.pack("<"+"h"*(16*16*8),*([-800]*(16*16*8))))
    return path

class MonaiSourceContract(unittest.TestCase):
    def test_conversion_preserves_native_hu_and_LPS(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=nifti(root/"ct.nii")
            info=module.original_nifti(source)
            self.assertEqual(info["dimensions"],[16,16,8])
            self.assertAlmostEqual(info["affineLps"][0],0.8,places=5)
            self.assertEqual(info["affineLps"][3],-140)
            out=root/"workspace";out.mkdir()
            mhd=module.prepare_monai_source(source,info,out)
            text=mhd.read_text()
            self.assertIn("ElementType = MET_SHORT",text)
            self.assertIn("ElementSpacing = 0.800000011921",text)
            self.assertEqual((out/"source.raw").read_bytes(),source.read_bytes()[352:])
            point=[info["affineLps"][0]*3+info["affineLps"][3],
                   info["affineLps"][5]*4+info["affineLps"][7],
                   info["affineLps"][10]*5+info["affineLps"][11]]
            self.assertEqual(module.world_to_voxel(info,point),[3,4,5])
    def test_unrelated_source_requires_sha_and_public_scope_attestation(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);file=nifti(root/"ct.nii")
            info=module.original_nifti(file)
            admission=root/"admission.json"
            admission.write_text(json.dumps({
                "schema":"opus-public-chest-nodule-admission/v1",
                "sourceNiftiSha256":info["sourceSha256"],"modality":"CT",
                "anatomy":"CHEST","intensity":"original-HU",
                "publicOrRightsClearedData":True,"containsPatientData":False,
                "fullSelectedSeriesPresent":True}))
            self.assertEqual(module.source_admission(admission,info)["modality"],"CT")
            admission.write_text(json.dumps({"schema":"opus-public-chest-nodule-admission/v1"}))
            with self.assertRaisesRegex(ValueError,"source_rights"):
                module.source_admission(admission,info)
    def test_invalid_source_and_model_output_never_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);file=nifti(root/"wrong.nii",wrong=True)
            with self.assertRaisesRegex(ValueError,"invalid_original_ct"):
                module.original_nifti(file)
            file=nifti(root/"ct.nii");info=module.original_nifti(file)
            result=root/"predict.json"
            result.write_text(json.dumps([{"box":[[140,100,-190,7,5,4]],"label":[1],"label_scores":[0.91]}]))
            c=module.parse_candidates(result,info)
            self.assertEqual(len(c),1)
            self.assertFalse(c[0]["sourceCoordinateFrameIndependentlyVerified"])
            result.write_text(json.dumps([{"box":[[140,100,-190,-7,5,4]],"label":[1],"label_scores":[0.91]}]))
            with self.assertRaisesRegex(ValueError,"invalid_model_candidate"):
                module.parse_candidates(result,info)

if __name__=="__main__":
    unittest.main()
