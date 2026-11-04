#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path
from unittest import mock
import deploy_pinned_detectors as deploy

ROOT = Path(__file__).resolve().parents[1]

class Decide(unittest.TestCase):
    def test_mac_never_downloads(self):
        reason, chosen = deploy.installs_for("full", "Darwin", 64 * 1024**3, 200 * 1024**3)
        self.assertEqual(reason, "mac")
        self.assertEqual(chosen, [])

    def test_small_linux_refuses(self):
        self.assertEqual(deploy.installs_for("basic", "Linux", 8 * 1024**3, 80 * 1024**3)[0], "ram")
        self.assertEqual(deploy.installs_for("full", "Linux", 32 * 1024**3, 10 * 1024**3)[0], "disk")

    def test_basic_is_only_the_chest_radiograph(self):
        reason, chosen = deploy.installs_for("basic", "Linux", 16 * 1024**3, 30 * 1024**3)
        self.assertEqual((reason, chosen), ("ok", ["chest_xray_six"]))

    def test_full_adds_pinned_weights_and_lung_tumor_only_at_64(self):
        small = deploy.installs_for("full", "Linux", 16 * 1024**3, 30 * 1024**3)[1]
        self.assertEqual(small, ["chest_xray_six", "chest_nodes", "lungmask_r231", "lung_nodules", "brain_hemorrhage",
                                 "chest_effusion", "abdomen_ct", "brain_wmh", "chest_pe"])
        large = deploy.installs_for("full", "Linux", 64 * 1024**3, 30 * 1024**3)[1]
        self.assertEqual(large[-1], "lung_tumor_cln")
        self.assertEqual(deploy.installs_for("other", "Linux", 64 * 1024**3, 30 * 1024**3)[0], "scope")

    def test_displayed_sizes_match_the_pinned_files(self):
        nodes = deploy.load("real-raidionics-mediastinal-onnx-cpu.py")
        ich = deploy.load("run-ianpan-ich-research.py")
        catalog = (ROOT / "web/lib/detector-deploy-plan.ts").read_text()
        lung = (ROOT / "services/imaging-ai/r231.py").read_text()
        self.assertIn(f"{nodes.MODEL_ARCHIVE_SIZE:,}".replace(",", " "), catalog)
        self.assertIn(f"{sum(size for _, size in ich.MODEL_FILES.values()):,}".replace(",", " "), catalog)
        self.assertIn(f"{deploy.NODULE_FILES['models/model.pt'][1]:,}".replace(",", " "), catalog)
        nodule = (ROOT / "services/imaging-ai/monai_bound_nodule.py").read_text()
        self.assertIn(deploy.NODULE_SHA, nodule)
        self.assertEqual(deploy.NODULE_FILES["models/model.pt"], (deploy.NODULE_SHA, 83709381))
        self.assertEqual(
            deploy.publisher_file_url(deploy.NODULE_REPO, deploy.NODULE_REV, "models/model.pt"),
            "https://huggingface.co/MONAI/lung_nodule_ct_detection/resolve/"
            "7226a40a4c3713f7d5469559b7f2fc296fd54825/models/model.pt")
        self.assertEqual(deploy.LIVER_SHA, "b3bdd53de65dc64a46264edfdeb491b18e8f95973a691eeccfa530d1da1678a0")
        self.assertEqual(deploy.WMH_SHA, "f7ef9747eb73ef8a927c07e4227bc4b9bfab761e0f7c60f2fd09ac9cf1a5fd3a")
        self.assertEqual(deploy.PE_BYTES, 566265379)
        self.assertIn(deploy.PE_VENDOR_REV, (ROOT / "services/imaging-ai/pe_ctpa_direct_worker.py").read_text())
        for label, count in (("233 744 954", deploy.EFFUSION_BYTES), ("230 592 397", deploy.KIDNEY_BYTES),
                             ("246 100 637", deploy.WMH_BYTES), ("566 265 379", deploy.PE_BYTES)):
            self.assertIn(f"{count:,}".replace(",", " "), catalog)
            self.assertIn(label, catalog)
        self.assertIn(deploy.LUNG_SHA, lung)
        self.assertIn(deploy.LUNG_URL, lung)
        self.assertNotIn("huggingface_hub", Path(deploy.__file__).read_text())

    def test_full_scope_names_the_programs_it_installs(self):
        specs = deploy.programs_for(
            ["chest_xray_six", "chest_nodes", "lungmask_r231", "brain_hemorrhage", "lung_tumor_cln"])
        self.assertEqual(specs, [
            "torchxrayvision==1.5.7", "raidionicsseg==1.5.2", "lungmask==0.2.20",
            "nnunetv2==2.7.0", "fastapi==0.115.12", "uvicorn==0.34.2"])
        self.assertEqual(deploy.programs_for(["lungmask_r231", "brain_hemorrhage", "lung_nodules"]), [])
        self.assertEqual(deploy.NODULE_PROGRAMS[0], "monai==1.4.0")
        ich = deploy.load("run-ianpan-ich-research.py")
        self.assertEqual(
            deploy.publisher_file_url(ich.MODEL_REPO, ich.MODEL_REV, "classifier/model.safetensors"),
            "https://huggingface.co/ianpan/ct-head-hemorrhage-detection/resolve/e6d89c2/classifier/model.safetensors")

    def test_services_do_not_start_without_their_programs(self):
        self.assertIn("публичное", deploy.launch_blocker("brain_hemorrhage", set(), set()))
        self.assertIn("torchxrayvision", deploy.launch_blocker("chest_xray_six", set(), set()))
        self.assertIsNone(deploy.launch_blocker(
            "chest_xray_six", {"torchxrayvision==1.5.7", "fastapi", "uvicorn"}, set()))

    def test_hemorrhage_weights_do_not_start_a_service(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(deploy.subprocess, "Popen") as popen:
            rows = deploy.start_services(Path(folder), ["brain_hemorrhage", "lungmask_r231"])
        popen.assert_not_called()
        self.assertEqual(rows, [{
            "id": "brain_hemorrhage", "started": False,
            "reason": "эта служба считает только заранее разрешённое публичное исследование",
        }])

    def test_nodule_service_does_not_start_without_its_linux_programs(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(deploy.subprocess, "Popen") as popen:
            with mock.patch.object(deploy.platform, "system", return_value="Darwin"):
                mac = deploy.start_services(Path(folder), ["lung_nodules"])
                refused = deploy.install_nodule_programs(Path(folder), ["lung_nodules"])
            with mock.patch.object(deploy.platform, "system", return_value="Linux"):
                linux = deploy.start_services(Path(folder), ["lung_nodules"])
        popen.assert_not_called()
        self.assertIn("Linux", mac[0]["reason"])
        self.assertIn("Linux", refused)
        self.assertIn("monai", linux[0]["reason"])
        self.assertFalse(mac[0]["started"])
        self.assertFalse(linux[0]["started"])

    def test_newly_pinned_services_do_not_start_on_mac(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(deploy.subprocess, "Popen") as popen:
            with mock.patch.object(deploy.platform, "system", return_value="Darwin"):
                rows = deploy.start_services(Path(folder), ["chest_effusion", "abdomen_ct", "brain_wmh", "chest_pe"])
        popen.assert_not_called()
        self.assertEqual([row["started"] for row in rows], [False, False, False, False])
        self.assertTrue(all("Linux" in row["reason"] for row in rows))

if __name__ == "__main__":
    unittest.main()
