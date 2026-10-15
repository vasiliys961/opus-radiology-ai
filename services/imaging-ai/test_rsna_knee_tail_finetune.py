import unittest
from types import SimpleNamespace
from rsna_knee_tail_finetune import configure_trainable_tail

class FakeParameter:
    def __init__(self): self.requires_grad=True
    def numel(self):return 1
    def requires_grad_(self,value):
        self.requires_grad=value
        return self
class FakeLayer:
    def __init__(self):self.p=FakeParameter()
    def parameters(self):return [self.p]
class FakeBackbone:
    def __init__(self):
        self.encoder=SimpleNamespace(layer=[FakeLayer() for _ in range(12)])
        self.layernorm=FakeLayer()
    def parameters(self):
        return [p for layer in self.encoder.layer+[self.layernorm] for p in layer.parameters()]
class TailTests(unittest.TestCase):
    def test_only_last_two_blocks_trainable(self):
        b=FakeBackbone()
        self.assertEqual(configure_trainable_tail(b,2),3)
        self.assertTrue(all(not x.p.requires_grad for x in b.encoder.layer[:-2]))
        self.assertTrue(all(x.p.requires_grad for x in b.encoder.layer[-2:]))
        self.assertTrue(b.layernorm.p.requires_grad)
    def test_invalid_block_count_rejected(self):
        for n in (0,-1,13):
            with self.subTest(n=n),self.assertRaises(ValueError):
                configure_trainable_tail(FakeBackbone(),n)
if __name__=="__main__":unittest.main()
