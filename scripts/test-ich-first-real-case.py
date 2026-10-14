#!/usr/bin/env python3
"""Lightweight admission-only contract; NEVER calls Torch or simulates inference."""
import importlib.util
from pathlib import Path
import json
import tempfile
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch

path=Path(__file__).with_name("run-ich-first-real-case.py")
spec=importlib.util.spec_from_file_location("ich_first_case",path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def dummy():
 return SimpleNamespace(
  public_research_authorization="PUBLIC-ICH-FULL-CASE",
  rights_attested=True,upstream_model_audited=True,
  dataset_citation_url="https://example.org/public/ich-research",
  source_sha256="a"*64,reference_sha256="b"*64,
  checkpoint_sha256=module.OFFICIAL_SAMIHS_CHECKPOINT_SHA256,wrapper_sha256="d"*64,
  slice_axis=2,batch_size=1,threshold=.5,
  max_model_seconds=300,reference_label=1,
  input="/does-not-exist/source.nii.gz",
  expert_mask="/does-not-exist/expert.nii.gz",
  output_dir="/does-not-exist/new-result",
  model_dir="/does-not-exist/model"
 )


class ICHFirstCaseOnly(TestCase):
 def test_mac_stops_before_loading_model(self):
  with patch.object(module.sys,"platform","darwin"):
   with self.assertRaisesRegex(ValueError,"not_mac"):
    module.validate_requested_case(dummy())

 def test_nonofficial_checkpoint_rejected_before_access_to_public_ct(self):
  args=dummy()
  args.checkpoint_sha256="a"*64
  with patch.object(module.sys,"platform","linux"):
   with self.assertRaisesRegex(ValueError,"official_samihs_trained_checkpoint"):
    module.validate_requested_case(args)

 def test_rights_and_model_audit_are_mandatory(self):
  args=dummy()
  with patch.object(module.sys,"platform","linux"):
   args.rights_attested=False
   with self.assertRaisesRegex(ValueError,"explicit_public_rights"):
    module.validate_requested_case(args)
   args.rights_attested=True
   args.upstream_model_audited=False
   with self.assertRaisesRegex(ValueError,"explicit_public_rights"):
    module.validate_requested_case(args)

 def test_missing_source_and_bad_public_citation_refused(self):
  args=dummy()
  with patch.object(module.sys,"platform","linux"):
   args.dataset_citation_url="http://example.org/terms"
   with self.assertRaisesRegex(ValueError,"plain_https"):
    module.validate_requested_case(args)
   args.dataset_citation_url="https://example.org/public/ich-research"
   with self.assertRaisesRegex(ValueError,"regular_bounded_nifti_required"):
    module.validate_requested_case(args)


class ExpertOriginEvidence(TestCase):
 def test_original_expert_to_binary_reference_traceability(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td)
   ct=root/"ct.nii.gz";original=root/"original.nii.gz"
   binary=root/"expert-binary.nii.gz";ontology=root/"ontology.json"
   manifest=root/"union.json"
   ct.write_bytes(b"synthetic-ct-metadata-test")
   original.write_bytes(b"synthetic-multiclass-mask-test")
   binary.write_bytes(b"synthetic-derived-mask-test")
   ontology.write_text(json.dumps({
    "sourceUrl":"https://example.org/original-ich-dataset-labels",
    "labelMeaning":{"1":"IPH","3":"SAH"}
   }))
   a=dummy()
   a.source_sha256=module.sha256_file(ct)
   a.reference_sha256=module.sha256_file(binary)
   a.reference_label=1
   a.derived_expert_manifest=str(manifest)
   a.original_expert_mask=str(original)
   a.label_ontology_json=str(ontology)
   manifest.write_text(json.dumps({
    "schema":"opus-ich-expert-binary-union/v1",
    "status":"derived_binary_union_from_operator_reviewed_expert_labelmap",
    "sourceCtSha256":a.source_sha256,
    "derivedBinaryMaskSha256":a.reference_sha256,
    "originalExpertMaskSha256":module.sha256_file(original),
    "ontologySha256":module.sha256_file(ontology),
    "ontologySourceUrl":"https://example.org/original-ich-dataset-labels",
    "hemorrhageLabelMeaning":{"1":"IPH","3":"SAH"},
    "hemorrhageLabelVoxelCounts":{"1":4,"3":5},
    "binaryPositiveVoxelCount":9,
    "nativeGeometryMatched":True,"resamplingPerformed":False,
    "sourceDicomSopMapped":False,
    "independentOntologyAuthenticityVerified":False,
    "operatorAttestedSourceAndAnnotationRights":True,
    "clinicalValidation":False
   }))
   details=module.verify_original_expert_provenance(a,ct.resolve(),binary.resolve())
   self.assertEqual(details["originalExpertMaskSha256"],module.sha256_file(original))
   self.assertEqual(details["perHemorrhageClassVoxels"],{"1":4,"3":5})
   self.assertFalse(details["independentOntologyAuthenticityVerified"])
   # An altered original mask cannot inherit approval from a derived mask.
   original.write_bytes(b"tampered-original-expert")
   with self.assertRaisesRegex(ValueError,"provenance_mismatch"):
    module.verify_original_expert_provenance(a,ct.resolve(),binary.resolve())
   original.write_bytes(b"synthetic-multiclass-mask-test")
   a.reference_label=3
   with self.assertRaisesRegex(ValueError,"label_one"):
    module.verify_original_expert_provenance(a,ct.resolve(),binary.resolve())

 def test_partial_original_provenance_is_rejected(self):
  a=dummy()
  a.derived_expert_manifest="/research/manifest.json"
  a.original_expert_mask=None
  a.label_ontology_json=None
  with self.assertRaisesRegex(ValueError,"requires_all_original_files"):
   module.verify_original_expert_provenance(a,Path("/public/ct.nii.gz"),
                                             Path("/public/reference.nii.gz"))


if __name__=="__main__":
 main()
