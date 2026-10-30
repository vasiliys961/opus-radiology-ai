"""Archive admission tests; no invented MONAI forward or patient files."""
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from renal_monai_triphasic_worker import validate_archive,create_app

def archive(path,entries):
    with zipfile.ZipFile(path,"w") as z:
        for name,value in entries.items():z.writestr(name,value)

class TriphasicAdmission(unittest.TestCase):
    def test_exact_archive_roles_required(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src=root/"source.zip"
            archive(src,{"artery.nii":b"x"*1024,"vein.nii":b"x"*1024,"excret.nii":b"x"*1024})
            values=validate_archive(src,root)
            self.assertEqual(set(values),{"artery.nii","vein.nii","excret.nii"})
            self.assertEqual(values["vein.nii"].stat().st_size>0,True)
    def test_prevent_missing_phase_traversal_and_duplicate_entries(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src=root/"source.zip"
            for entries in (
                {"artery.nii":b"x"*1024,"vein.nii":b"x"*1024},
                {"artery.nii":b"x"*1024,"vein.nii":b"x"*1024,"../../excret.nii":b"x"*1024},
                {"artery.nii":b"x"*1024,"vein.nii":b"x"*1024,"excret.nii":b"x"},
            ):
                archive(src,entries)
                with self.assertRaises(ValueError):validate_archive(src,root)
    def test_original_checkpoint_is_required(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,"publisher_checkpoint_missing"):
                create_app(token="x"*40,checkpoint=Path(d)/"model.pt")

if __name__=="__main__":unittest.main()
