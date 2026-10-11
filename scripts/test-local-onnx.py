#!/usr/bin/env python3
"""Synthetic-only end-to-end test of the actual offline ONNX Runtime.
Weights are an ephemeral identity network made in the test itself, never a
pretrained medical model. Nothing downloaded from a model host.
"""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import onnx
from onnx import TensorProto, helper

RUNNER = Path(__file__).with_name("run-local-onnx.py")
SOURCE = "a" * 64
REQUEST_ID = "11111111-1111-4111-8111-111111111111"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def make_input():
    hdr = bytearray(352)
    struct.pack_into("<i", hdr, 0, 348)
    struct.pack_into("<4h", hdr, 40, 3, 3, 2, 3)
    struct.pack_into("<h", hdr, 70, 16)
    struct.pack_into("<h", hdr, 72, 32)
    struct.pack_into("<f", hdr, 108, 352)
    struct.pack_into("<f", hdr, 112, 1)
    hdr[123] = 2
    struct.pack_into("<h", hdr, 254, 1)
    affine = [-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0]
    struct.pack_into("<12f", hdr, 280, *affine)
    hdr[344:348] = b"n+1\x00"
    # 3 slices, normalized: expect 4 positive voxels.
    vals = np.array([0, 0, 10, 0, 10, 0,
                     10, 0, 0, 0, 0, 0,
                     10, 0, 0, 0, 0, 0], dtype="<f4")
    return bytes(hdr) + vals.tobytes()


def make_onnx(path):
    x = helper.make_tensor_value_info("volume", TensorProto.FLOAT, [1, 1, 2, 3])
    y = helper.make_tensor_value_info("probability", TensorProto.FLOAT, [1, 1, 2, 3])
    graph = helper.make_graph([helper.make_node("Identity", ["volume"], ["probability"])],
                              "synthetic-identity", [x], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    path.write_bytes(model.SerializeToString())


class OfflineInferenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="opus-onnx-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.input = self.root / "source.nii"
        self.input.write_bytes(make_input())
        self.model = self.root / "identity.onnx"
        make_onnx(self.model)
        self.request = self.root / "source.request.json"
        self.reqdata = {
            "schema": "opus-analysis-request/v1",
            "requestId": REQUEST_ID,
            "sourceIdentitySha256": SOURCE,
            "inputSha256": sha(self.input.read_bytes()),
            "geometry": {"dimensions": [3, 2, 3],
                         "affineLps": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]},
            "modality": "CT", "frameCount": 3, "scope": "selected-series-only",
            "input": {
                "format": "NIfTI-1", "datatype": "float32",
                "scalarValues": "cornerstone-decoded-no-additional-normalization",
            },
        }
        self.profile = self.root / "profile.json"
        self.profdata = {
            "schema": "opus-local-onnx-profile/v1",
            "model": {"id": "synthetic/identity", "version": "fixture-only",
                      "modality": "CT", "task": "mathematical-bin-threshold",
                      "sha256": sha(self.model.read_bytes()),
                      "label": "Artificial high-intensity pixels"},
            "preprocessing": {"method": "fixed-clip-zero-one", "clipMin": 0, "clipMax": 10},
            "output": {"format": "NCHW-single-channel-binary",
                       "threshold": 0.5, "activation": "identity"},
            "limitations": ["Fixture validates pipeline only; no medical model trained."],
        }
        self.mask = self.root / "result-mask.nii"
        self.result = self.root / "result.json"
        self.persist()

    def persist(self):
        self.request.write_text(json.dumps(self.reqdata))
        self.profile.write_text(json.dumps(self.profdata))

    def run_cli(self):
        return subprocess.run([sys.executable, str(RUNNER), "--input", str(self.input),
             "--request", str(self.request), "--model", str(self.model),
             "--profile", str(self.profile), "--mask", str(self.mask),
             "--result", str(self.result)], capture_output=True, text=True, timeout=60)

    def test_real_cpu_runtime_produces_geometry_bound_mask_and_passport(self):
        p = self.run_cli()
        self.assertEqual(p.returncode, 0, p.stderr)
        mask = self.mask.read_bytes()
        self.assertEqual(len(mask), 352 + 18)
        self.assertEqual(struct.unpack_from("<hh", mask, 70), (2, 8))
        self.assertEqual(mask[352:].count(1), 4)
        self.assertEqual(struct.unpack_from("<12f", mask, 280),
                         struct.unpack_from("<12f", self.input.read_bytes(), 280))
        result = json.loads(self.result.read_text())
        self.assertEqual(result["maskSha256"], sha(mask))
        self.assertEqual(result["inputSha256"], self.reqdata["inputSha256"])
        self.assertEqual(result["model"]["weightsSha256"], self.profdata["model"]["sha256"])
        self.assertEqual(result["sourceIdentitySha256"], SOURCE)
        self.assertEqual(result["labels"], [{"id": 1, "name": "Artificial high-intensity pixels"}])
        self.assertIn("0 bytes", p.stdout)
        self.assertNotIn("API", p.stdout)
        # Fail closed on attempted overwrite.
        again = self.run_cli()
        self.assertNotEqual(again.returncode, 0)
        self.assertEqual(self.mask.read_bytes(), mask)

    def test_changed_input_is_rejected_before_any_output(self):
        raw = bytearray(self.input.read_bytes())
        raw[-1] ^= 1
        self.input.write_bytes(raw)
        proc = self.run_cli()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("SHA-256 mismatch", proc.stderr)
        self.assertFalse(self.mask.exists())

    def test_changed_weights_rejected_even_when_onnx_shape_stays_valid(self):
        self.profdata["model"]["sha256"] = "0" * 64
        self.persist()
        proc = self.run_cli()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("Checkpoint hash mismatch", proc.stderr)
        self.assertFalse(self.mask.exists())

    def test_modality_and_geometry_are_verified(self):
        self.reqdata["modality"] = "MR"
        self.persist()
        self.assertIn("modality", self.run_cli().stderr)
        self.reqdata["modality"] = "CT"
        self.reqdata["geometry"]["affineLps"][3] = 70
        self.persist()
        self.assertIn("geometry", self.run_cli().stderr.lower())
        self.assertFalse(self.mask.exists())

    def test_model_preprocessing_is_not_guessed(self):
        self.profdata["preprocessing"].pop("clipMin")
        self.persist()
        self.assertIn("Preprocessing contract", self.run_cli().stderr)
        self.profdata["preprocessing"]["clipMin"] = 0
        self.profdata["model"]["sha256"] = "not-a-hash"
        self.persist()
        self.assertIn("unpinned", self.run_cli().stderr)
        self.assertFalse(self.mask.exists())

    def test_unexpected_clinical_content_is_not_part_of_model_profile(self):
        self.profdata["patientNote"] = "Never forward patient narrative"
        self.persist()
        self.assertIn("Unknown or missing model profile fields", self.run_cli().stderr)
        self.assertFalse(self.mask.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
