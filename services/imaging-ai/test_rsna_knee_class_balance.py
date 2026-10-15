import unittest
from rsna_knee_class_balance import positive_weights
from rsna_knee import LABELS

class ClassBalanceTest(unittest.TestCase):
    def test_unknown_excluded_and_heldout_not_included(self):
        train=[{"ACL":"1"},{"ACL":"0"},{"ACL":"0"},{"ACL":""}]
        weights,counts=positive_weights(train,max_weight=5)
        self.assertEqual(weights[0],2)
        self.assertEqual(counts["positives"][0],1)
        self.assertEqual(counts["negatives"][0],2)
        self.assertEqual(weights[1],1)
        self.assertEqual(len(weights),len(LABELS))
    def test_caps_extreme_imbalance(self):
        w,_=positive_weights([{"ACL":"1"}]+[{"ACL":"0"}]*50,max_weight=3)
        self.assertEqual(w[0],3)
    def test_no_positives_is_not_infinite(self):
        w,_=positive_weights([{"ACL":"0"}]*5)
        self.assertEqual(w[0],1)
if __name__=="__main__":unittest.main()
