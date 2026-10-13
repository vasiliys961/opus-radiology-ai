#!/usr/bin/env python3
"""Lightweight admission-only contract; NEVER calls Torch or simulates inference."""
import importlib.util
from pathlib import Path
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
  checkpoint_sha256="c"*64,wrapper_sha256="d"*64,
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


if __name__=="__main__":
 main()
