import unittest
from types import SimpleNamespace
from rsna_knee import LABELS
from rsna_knee_warmstart import validate_warmstart

class WarmstartTests(unittest.TestCase):
    def setUp(self):
        self.args=SimpleNamespace(slices=8,series_limit=3,pixel_mode="dicom",
                                  slice_order="geometry-v2",series_selection="balanced")
        self.ckpt={"model":"dinov2-small-finding-mil-v2",
                   "head_family":"finding-v2","encoder_id":"facebook/dinov2-small:frozen-v1",
                   "labels":list(LABELS),"epoch":5,"state_dict":{"weight":1},
                   "head_state_dict":{"weight":2},
                   **{key:getattr(self.args,key) for key in
                      ("slices","series_limit","pixel_mode","slice_order","series_selection")}}
    def test_valid_checkpoint_requires_fresh_optimizer(self):
        result=validate_warmstart(self.ckpt,self.args)
        self.assertTrue(result["fresh_optimizer"])
        self.assertEqual(result["source_epoch"],5)
    def test_reject_label_reordering(self):
        self.ckpt["labels"]=list(reversed(LABELS))
        with self.assertRaisesRegex(ValueError,"label"):validate_warmstart(self.ckpt,self.args)
    def test_reject_changed_geometry(self):
        self.ckpt["slices"]=12
        with self.assertRaisesRegex(ValueError,"geometry"):validate_warmstart(self.ckpt,self.args)
    def test_reject_legacy_head(self):
        self.ckpt["head_family"]="legacy"
        with self.assertRaises(ValueError):validate_warmstart(self.ckpt,self.args)
    def test_reject_empty_weights(self):
        self.ckpt["head_state_dict"]={}
        with self.assertRaises(ValueError):validate_warmstart(self.ckpt,self.args)
if __name__=="__main__":unittest.main()
