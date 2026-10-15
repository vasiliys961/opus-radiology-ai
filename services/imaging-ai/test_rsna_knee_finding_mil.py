import unittest
from rsna_knee_finding_mil import make_finding_mil


class FindingMILTests(unittest.TestCase):
    def setUp(self):
        try:
            import torch
        except ImportError:
            self.skipTest('torch optional in generic CI')
    def test_separate_attention_and_gradients(self):
        try:
            import torch
        except ImportError:
            self.skipTest("torch is optional")
        torch.manual_seed(4)
        net=make_finding_mil(8,findings=12,dropout=0)
        features=torch.randn(7,8,requires_grad=True)
        logits,attention=net(features,return_attention=True)
        self.assertEqual(tuple(logits.shape),(12,))
        self.assertEqual(tuple(attention.shape),(12,7))
        torch.testing.assert_close(attention.sum(dim=1),torch.ones(12))
        self.assertFalse(torch.allclose(attention[0],attention[1]))
        logits.sum().backward()
        self.assertTrue(torch.isfinite(features.grad).all())
        self.assertTrue(torch.isfinite(net.classifier.grad).all())

    def test_valid_window_mask(self):
        import torch
        net=make_finding_mil(4,dropout=0).eval()
        features=torch.randn(5,4)
        valid=torch.tensor([True,False,True,False,True])
        scores,weights=net(features,valid=valid,return_attention=True)
        self.assertEqual(tuple(scores.shape),(12,))
        self.assertTrue(torch.equal(weights[:,~valid],torch.zeros(12,2)))
        with self.assertRaises(ValueError):
            net(features,valid=torch.zeros(5,dtype=torch.bool))

    def test_single_window(self):
        import torch
        net=make_finding_mil(4)
        _,weights=net(torch.zeros(1,4),return_attention=True)
        torch.testing.assert_close(weights,torch.ones(12,1))


if __name__=="__main__":
    unittest.main()
