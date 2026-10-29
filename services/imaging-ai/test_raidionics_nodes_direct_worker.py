"""Technical source-admission and local browser gates (not a pretrained run)."""
from pathlib import Path
import tempfile
import unittest
import numpy as np
import nibabel as nib
from raidionics_nodes_direct_worker import (
    create_app,axial_lungmask_request,verified_model_archive,
)


class MediastinalPreflight(unittest.TestCase):
    def test_loopback_session_rejects_missing_token_before_model_disk_io(self):
        with self.assertRaisesRegex(ValueError,"token_required"):
            create_app(token="bad",origin="http://127.0.0.1:3000",
                model_zip="/none",lungmask_weights="/none")
        with self.assertRaisesRegex(ValueError,"origin_required"):
            create_app(token="X"*42,origin="https://unknown.example",
                model_zip="/none",lungmask_weights="/none")

    def test_true_source_geometry_admitted_and_oblique_refused_for_r231(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/"original.nii"
            image=nib.Nifti1Image(np.zeros((9,10,11),dtype=np.float32),
                np.diag([1.0,1.0,1.5,1.0]))
            image.header.set_xyzt_units("mm")
            nib.save(image,str(source))
            r=axial_lungmask_request(source,nib.load(str(source)))
            self.assertEqual(r["geometry"]["dimensions"],[9,10,11])
            self.assertEqual(r["frameCount"],11)
            self.assertEqual(r["schema"],"opus-analysis-request/v2")
            a=np.diag([1.0,1.0,1.5,1.0])
            a[0,1]=.15
            oblique=nib.Nifti1Image(np.zeros((9,10,11),dtype=np.float32),a)
            nib.save(oblique,str(source))
            with self.assertRaisesRegex(ValueError,"unsupported_oblique"):
                axial_lungmask_request(source,nib.load(str(source)))

if __name__=="__main__":
    unittest.main()
