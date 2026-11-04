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
        self.assertEqual(small, ["chest_xray_six", "chest_nodes", "lungmask_r231", "brain_hemorrhage"])
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
        self.assertIn(deploy.LUNG_SHA, lung)
        self.assertIn(deploy.LUNG_URL, lung)
        self.assertNotIn("huggingface_hub", Path(deploy.__file__).read_text())
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

if __name__ == "__main__":
    unittest.main()
