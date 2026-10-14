#!/usr/bin/env python3
"""Numerical geometry/guard tests on generated arrays; NO SAMIHS inference."""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import nibabel as nib
import numpy as np

path=Path(__file__).with_name("run-ich-samihs-cpu-pilot.py")
spec=importlib.util.spec_from_file_location("bounded_samihs_cpu",path)
pilot=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def make_files(root, expert_position=20):
    image=np.zeros((32,32,40),dtype=np.float32)
    image[3,4,19]=81.0
    expert=np.zeros_like(image,dtype=np.uint8)
    expert[3,4,expert_position]=1
    affine=np.diag([.75,.75,2.5,1.])
    affine[:3,3]=[6,7,-22]
    paths=[]
    for name,arr in (("ct.nii.gz",image),("original-reference.nii.gz",expert)):
        nii=nib.Nifti1Image(arr,affine)
        nii.header.set_xyzt_units(xyz="mm")
        nii.set_sform(affine,code=1)
        nii.set_qform(affine,code=1)
        file=root/name
        nib.save(nii,str(file))
        paths.append(file)
    return paths


def args(root,source,reference):
    return SimpleNamespace(
        mode="prepare",input=str(source),expert_mask=str(reference),
        output_dir=str(root/"results"),
        source_sha256=pilot.sha256_file(source),
        reference_sha256=pilot.sha256_file(reference),
        dataset_citation_url="https://zenodo.org/records/8228847",
        authorization="AUTHORIZED-PUBLIC-ICH-CPU-SLAB",
        rights_attested=True,deidentified_public_data=True,
        start_slice=12,slice_axis=2,slice_count=16,reference_label=1,
        timeout_seconds=300,model_dir=None,checkpoint_sha256=None,
        wrapper_sha256=None,upstream_model_audited=False,
    )


class NativeCpuPilotContracts(unittest.TestCase):
    def test_native_source_coordinate_and_mask_preserved_without_execution(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            ct,ref=make_files(root)
            cfg=args(root,ct,ref)
            result=pilot.run(cfg)
            self.assertEqual(result["status"],"prepared_real_public_slab_no_model_execution")
            self.assertFalse(result["model"]["executed"])
            self.assertIsNone(result["metrics"])
            self.assertFalse(result["fullOriginalStudyProcessed"])
            self.assertEqual(result["source"]["expertPositiveVoxelsInSlab"],1)
            slab=nib.load(str(root/"results"/"source-native-slab.nii.gz"))
            expert=nib.load(str(root/"results"/"expert-native-binary-slab.nii.gz"))
            original=nib.load(str(ct))
            self.assertEqual(slab.shape,(32,32,16))
            np.testing.assert_array_equal(np.asarray(slab.dataobj),np.asarray(original.dataobj)[:,:,12:28])
            np.testing.assert_allclose(slab.affine @ [3,4,7,1], original.affine @ [3,4,19,1])
            np.testing.assert_allclose(expert.affine,slab.affine)
            self.assertEqual(int(np.sum(np.asarray(expert.dataobj))),1)
            self.assertEqual(result["source"]["originalCtSha256"],pilot.sha256_file(ct))
            self.assertEqual(result["source"]["slabExpertSha256"],
                             pilot.sha256_file(root/"results"/"expert-native-binary-slab.nii.gz"))
            self.assertFalse((root/"results"/"samihs-cpu-slab-mask.nii.gz").exists())

    def test_no_positive_expert_in_cropped_slab_fails_instead_of_claiming_normal(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            ct,ref=make_files(root,expert_position=35)
            with self.assertRaisesRegex(ValueError,"positive_expert"):
                pilot.run(args(root,ct,ref))

    def test_rights_model_and_source_hash_guards_before_io(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            ct,ref=make_files(root)
            cfg=args(root,ct,ref)
            cfg.rights_attested=False
            with self.assertRaisesRegex(ValueError,"authorized_public"):
                pilot.admission(cfg)
            cfg.rights_attested=True
            cfg.source_sha256="0"*64
            with self.assertRaisesRegex(ValueError,"original_source_and_expert"):
                pilot.admission(cfg)
            cfg.source_sha256=pilot.sha256_file(ct)
            cfg.mode="infer"
            with self.assertRaisesRegex(ValueError,"upstream_model_requires_express_approval_or_audit"):
                pilot.admission(cfg)
            cfg.upstream_model_audited=True
            cfg.model_dir=str(root)
            cfg.checkpoint_sha256="a"*64
            cfg.wrapper_sha256="b"*64
            with self.assertRaisesRegex(ValueError,"official_samihs"):
                pilot.admission(cfg)

    def test_wrong_grid_and_non_native_axis_refused(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            ct,ref=make_files(root)
            cfg=args(root,ct,ref)
            cfg.slice_axis=1
            with self.assertRaisesRegex(ValueError,"native_k_axis"):
                pilot.admission(cfg)
            cfg.slice_axis=2
            changed=nib.load(str(ref))
            offset=changed.affine.copy()
            offset[2,3]+=3.0
            changed.set_sform(offset,code=1)
            changed.set_qform(offset,code=1)
            nib.save(changed,str(ref))
            cfg.reference_sha256=pilot.sha256_file(ref)
            with self.assertRaisesRegex(ValueError,"native_mm_grid_mismatch"):
                pilot.run(cfg)

    def test_unsupported_roi_and_overlong_runtime_refused(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            ct,ref=make_files(root)
            cfg=args(root,ct,ref)
            cfg.slice_count=40
            with self.assertRaisesRegex(ValueError,"16_or_32"):
                pilot.admission(cfg)
            cfg.slice_count=32
            cfg.start_slice=15
            with self.assertRaisesRegex(ValueError,"source_or_slice_span"):
                pilot.run(cfg)
            cfg.start_slice=8
            cfg.timeout_seconds=1801
            with self.assertRaisesRegex(ValueError,"bounded_cpu_inference_timeout"):
                pilot.admission(cfg)


    def test_original_float_binary_expert_mask_is_losslessly_projected(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            ct,ref=make_files(root)
            original=nib.load(str(ref))
            expert_float=np.asarray(original.dataobj,dtype=np.float32)
            nii=nib.Nifti1Image(expert_float,original.affine)
            nii.set_sform(original.affine,code=1)
            nii.set_qform(original.affine,code=1)
            nii.header.set_xyzt_units(xyz="mm")
            nib.save(nii,str(ref))
            result=pilot.run(args(root,ct,ref))
            self.assertFalse(result["model"]["executed"])
            self.assertEqual(result["source"]["expertPositiveVoxelsInSlab"],1)
            generated=nib.load(str(root/"results"/"expert-native-binary-slab.nii.gz"))
            self.assertEqual(int(np.asarray(generated.dataobj).sum()),1)
            self.assertEqual(generated.header.get_data_dtype().kind,"u")


    def test_explicit_native_qform_only_coordinates_round_trip(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            ct,ref=make_files(root)
            original=nib.load(str(ct))
            for file in (ct,ref):
                nii=nib.load(str(file))
                affine=nii.affine.copy()
                nii.set_sform(affine,code=0)
                nii.set_qform(affine,code=1)
                nib.save(nii,str(file))
            cfg=args(root,ct,ref)
            result=pilot.run(cfg)
            self.assertFalse(result["model"]["executed"])
            exported=nib.load(str(root/"results"/"source-native-slab.nii.gz"))
            self.assertEqual(int(exported.header["qform_code"]),1)
            np.testing.assert_allclose(
                exported.affine @ [3,4,7,1],
                original.affine @ [3,4,19,1],rtol=0,atol=1e-4)

    def test_missing_original_physical_affine_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);ct,ref=make_files(root)
            original=nib.load(str(ct))
            affine=original.affine.copy()
            original.set_sform(affine,code=0)
            original.set_qform(affine,code=0)
            nib.save(original,str(ct))
            cfg=args(root,ct,ref)
            with self.assertRaisesRegex(ValueError,"native_mm_grid_mismatch"):
                pilot.run(cfg)


    def test_upstream_failure_classification_never_exposes_identifiers_or_paths(self):
        sensitive=(b'Traceback (most recent call last):\n'
                   b' File "/private/sah_rhuh_002/person_138/segment_ich.py", line 111\n'
                   b'ModuleNotFoundError: No module named ' + b"'einops'")
        diagnostic=pilot.classify_upstream_failure(sensitive,1)
        self.assertIn("category=missing_python_module; module=einops",diagnostic)
        for forbidden in ("sah_rhuh", "/private/", "person_138", "segment_ich.py"):
            self.assertNotIn(forbidden,diagnostic)

    def test_known_upstream_cpu_failures_produce_actionable_anonymous_categories(self):
        examples={
            b"RuntimeError: Torch not compiled with CUDA enabled":"upstream_requires_cuda",
            b"RuntimeError: Weights only load failed.":"upstream_pytorch_checkpoint_loader",
            b"segment_ich.py: error: unrecognized arguments: --slice-axis 2":"incompatible_upstream_cli",
            b"RuntimeError: size mismatch for model.encoder.weight in state_dict":"checkpoint_architecture_mismatch",
            b"ValueError: patient_039 /secret/path":"upstream_valueerror",
            b"an unrecognized exception /secret/path":"unclassified_vendor_failure",
        }
        for raw,category in examples.items():
            with self.subTest(category=category):
                result=pilot.classify_upstream_failure(raw,1)
                self.assertIn("category="+category,result)
                self.assertNotIn("/secret/",result)
                self.assertIn("diagnosticSha256Prefix=",result)

    def test_real_child_process_exit_diagnostic_is_private(self):
        import sys
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(RuntimeError,"missing_python_module") as caught:
                pilot.invoke_verified_upstream(
                    [sys.executable,"-c",
                     "import sys; print('PHI 123 secret/identifier',file=sys.stderr); "
                     "raise ModuleNotFoundError(\"No module named 'fictional_dependency'\")"],
                    Path(td),120)
            self.assertNotIn("secret/identifier",str(caught.exception))
            self.assertIn("module=fictional_dependency",str(caught.exception))



if __name__=="__main__":
    unittest.main()
