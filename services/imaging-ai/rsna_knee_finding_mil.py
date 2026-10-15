"""Finding-specific attention MIL head for 12 RSNA knee pathologies.

Unlike legacy single-attention MIL, this module learns a separate distribution
over MRI windows for every pathology. It accepts arbitrary encoder features
[N, D]; no additional DICOM or network dependencies. Research only.
"""
def make_finding_mil(feature_dim, findings=12, hidden=128, dropout=0.1):
    import torch
    from torch import nn

    if type(feature_dim) is not int or feature_dim<1 or type(findings) is not int or findings<1:
        raise ValueError("Positive feature_dim and findings required")

    class FindingMIL(nn.Module):
        def __init__(self):
            super().__init__()
            self.attention=nn.Sequential(
                nn.Linear(feature_dim,hidden),
                nn.Tanh(),
                nn.Dropout(dropout),
                nn.Linear(hidden,findings))
            self.classifier=nn.Parameter(torch.empty(findings,feature_dim))
            self.bias=nn.Parameter(torch.zeros(findings))
            nn.init.xavier_uniform_(self.classifier)

        def forward(self,features,valid=None,return_attention=False):
            if features.ndim!=2 or features.shape[0]<1 or features.shape[1]!=feature_dim:
                raise ValueError("Expected [windows, feature_dim]")
            logits=self.attention(features)  # [windows, findings]
            if valid is not None:
                if valid.ndim!=1 or valid.shape[0]!=features.shape[0] or not bool(valid.any()):
                    raise ValueError("Valid mask must include at least one window")
                logits=logits.masked_fill(~valid.bool().unsqueeze(1),torch.finfo(logits.dtype).min)
            weights=logits.softmax(dim=0)   # independent attention per finding
            pooled=weights.transpose(0,1) @ features  # [findings, feature_dim]
            predictions=(pooled*self.classifier).sum(dim=1)+self.bias
            return (predictions,weights.transpose(0,1)) if return_attention else predictions
    return FindingMIL()
