#!/usr/bin/env python3
"""Clinical-negative guard: no real checkpoint, no CT pixels from people."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

src=Path(__file__).with_name("run-ianpan-ich-research.py")
spec=importlib.util.spec_from_file_location("opus_ianpan_figshare_model",src)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class PublicHemorrhageSource(unittest.TestCase):
    def test_real_publisher_origin_contract_without_earned_hu_or_medical_diagnosis(self):
        import nibabel as nib
        import numpy as np
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            source=root/"original.nii"
            vox=np.full((32,32,8),-1000,np.float32)
            vox[4:28,4:28,:]=37.
            image=nib.Nifti1Image(vox,np.eye(4))
            nib.save(image,source)
            pub={
                "repository":"Figshare","articleId":23957937,
                "license":"CC BY 4.0","fileId":63081925,
                "publishedArchiveSize":1300209108,
                "publishedArchiveMd5MetadataOnlyNotRecomputed":"a2c3f32f11478167b975d5036edbb510",
                "originalMemberCRC32Checked":True,
                "originalGzipSha256":"a"*64,
                "huFromOriginalDicomRescaleIndependentlyVerified":False,
                "originalFullVolumePreserved":True,
                "intensityUnitsOnlyPlausibleHU":True,
                "fullVolumeDimensions":[32,32,8],
                "positiveHemorrhageStudyPerPublishedCohortNotIndependentlyDiagnosed":True,
                "referenceLabelsArePerihematomalEdemaNotHemorrhage":True,
                "expertHematomaMaskCompared":False,
                "modelLesionDetectionProven":False,
            }
            evidence={
                "schema":"opus-public-head-ct-hu-evidence/v1",
                "modality":"CT","anatomy":"HEAD","contrast":"NONCONTRAST",
                "publicDataRightsReviewed":True,
                "deidentifiedPublicDataset":True,
                "sourceUnits":"PUBLISHED_FIGSHARE_NONCONTRAST_CT_HU_LIKE_NOT_INDEPENDENTLY_VERIFIED",
                "sourceFullStudy":True,
                "consent":"PUBLIC-HEAD-NCCT-RESEARCH-OK",
                "sourceNiftiSha256":m.sha256(source),
                "publisherProvenance":pub,
            }
            manifest=root/"manifest.json"
            manifest.write_text(json.dumps(evidence))
            admitted=m.validate_public_manifest(source,manifest)
            self.assertFalse(m.source_units_is_verified(admitted))
            self.assertTrue(m.figshare_source_is_published(admitted))
            for change in (
                {"sourceUnits":"NORMALIZED_UNKNOWN"},
                {"publisherProvenance":{**pub,"originalMemberCRC32Checked":False}},
                {"publisherProvenance":{**pub,"expertHematomaMaskCompared":True}},
                {"publisherProvenance":{**pub,"huFromOriginalDicomRescaleIndependentlyVerified":True}},
                {"publisherProvenance":{**pub,"fullVolumeDimensions":[32,32,9]}},
                {"sourceNiftiSha256":"f"*64}
            ):
                manifest.write_text(json.dumps({**evidence,**change}))
                with self.assertRaises(ValueError):
                    m.validate_public_manifest(source,manifest)

if __name__=="__main__":
    unittest.main()
