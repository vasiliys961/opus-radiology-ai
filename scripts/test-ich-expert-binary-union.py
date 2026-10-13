#!/usr/bin/env python3
"""Numerical annotation-mapping contract, NOT expert image validation or inference."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

path=Path(__file__).with_name("build-ich-expert-binary-union.py")
spec=importlib.util.spec_from_file_location("ich_expert_binary_union",path)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MulticlassICHUnionTests(unittest.TestCase):
 def test_source_documented_hemorrhage_labels_are_all_retained(self):
  ontology=m.check_ontology({
   "sourceUrl":"https://dataset.example.org/original-label-ontology",
   "labelMeaning":{"1":"IPH","2":"IVH","5":"SAH"}
  })
  source=np.zeros((16,16,16),dtype=np.uint16)
  source[1:3,1:3,1:3]=1
  source[5:7,5:7,5:7]=2
  source[9:11,9:11,9:11]=5
  b,counts=m.binary_union(source,ontology)
  self.assertEqual(int(np.count_nonzero(b)),24)
  self.assertEqual(set(np.unique(b)),{0,1})
  self.assertEqual(counts,{"1":8,"2":8,"5":8})

 def test_unmapped_nonzero_label_is_never_inferred_as_hemorrhage(self):
  mask=np.zeros((16,16,16),dtype=np.uint8)
  mask[1,1,1]=7
  with self.assertRaisesRegex(ValueError,"unknown_nonzero_label"):
   m.binary_union(mask,{1:"IPH"})
  with self.assertRaisesRegex(ValueError,"original_dataset_label_ontology"):
   m.check_ontology({"labelMeaning":{"1":"IPH"}})
  with self.assertRaisesRegex(ValueError,"unsupported_or_undocumented"):
   m.check_ontology({
    "sourceUrl":"https://dataset.example.org/labels",
    "labelMeaning":{"1":"brain_tumor"}
   })


if __name__=="__main__":
 unittest.main()
