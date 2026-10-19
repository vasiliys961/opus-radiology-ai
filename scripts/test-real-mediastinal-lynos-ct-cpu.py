"""CPU mediastinal original inference preflight safety, no model or patient network."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile
from unittest.mock import patch

SCRIPT=Path(__file__).with_name("real-mediastinal-lynos-ct-cpu.py")
spec=importlib.util.spec_from_file_location("lynos_cpu_original",SCRIPT)
model=importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)

class OriginalMediastinumTests(unittest.TestCase):
    def test_publisher_pinning_and_no_gpu_or_patient_data(self):
        self.assertEqual(model.PUBLISHER_COMMIT,"f1eedfe117da9fe5377daa3b2e72fc268e5c7867")
        self.assertEqual(model.WEIGHTS_DRIVE_ID,"1DBIl8JyXEo6YdM9uNyo3vrv5T2WsYSXT")
        self.assertEqual(model.WEIGHTS_MD5,"434775bebd64910e01f4198eab251666")
        self.assertEqual(model.MODEL,"UNet-SW32")
        self.assertIn("10102261",model.LYNOS_URL)
        self.assertLessEqual(model.MAX_WEIGHTS_ZIP,1400*1024*1024)
        self.assertLessEqual(model.RUNTIME_SECONDS,1650)
    def test_archive_member_rejects_traversal_symlink_and_large_files(self):
        for name in ("/etc/passwd","../../evil.h5","a/../model.h5","models\\trick.h5"):
            with self.assertRaises(ValueError):
                model.validate_archive_member(zipfile.ZipInfo(name))
        giant=zipfile.ZipInfo("models/UNet-SW32/model.h5")
        giant.file_size=model.MAX_ZIP_MEMBER+1
        with self.assertRaises(ValueError):
            model.validate_archive_member(giant)
        link=zipfile.ZipInfo("models/UNet-SW32/model.h5")
        link.create_system=3
        link.external_attr=(stat.S_IFLNK|0o777)<<16
        with self.assertRaises(ValueError):
            model.validate_archive_member(link)
    def test_no_synthetic_checkpoint_passes_integrity(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            archive=root/"pretend-models.zip"
            with zipfile.ZipFile(archive,"w") as out:
                for name in ("CT_Lungs","UNet-SW32"):
                    out.writestr(f"{name}/model.h5",b"not real pretrained"*5000)
                    out.writestr(f"{name}/pre_processing.ini",b"[PreProcessing]\n")
            with self.assertRaisesRegex(ValueError,"md5_mismatch"):
                model.verify_publisher_zip(archive,root/"models")
    def test_research_cpu_worker_must_have_resource_limits(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with patch.object(model.shutil,"disk_usage",return_value=(99999,99999,1)):
                with self.assertRaisesRegex(ValueError,"disk"):
                    model.work_dir(root)
    def test_no_upload_of_identifiable_images_in_source_output(self):
        source=SCRIPT.read_text()
        for guard in ("--network",'"none"',"--memory","--cpus",
                      "originalArchiveMD5Verified","actualOriginalPretrainedModelForwardCompleted",
                      "clinicallyValidated","patientUseAllowed","LyNoS_Zenodo_range_unavailable"):
            self.assertIn(guard,source)
        self.assertNotIn("OPENROUTER_API_KEY",source)
        self.assertNotIn("patientName",source)

if __name__=="__main__":
    unittest.main()
