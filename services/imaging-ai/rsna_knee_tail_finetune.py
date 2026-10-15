"""Memory-bounded DINOv2 tail fine-tuning utilities for knee MRI.

Freeze early transformer blocks and train final blocks with gradients.
Unlike cached frozen embeddings, this path recomputes features every step.
"""
def configure_trainable_tail(backbone, last_blocks):
    if not isinstance(last_blocks,int) or last_blocks<1:
        raise ValueError("last_blocks must be positive")
    layers=backbone.encoder.layer
    if last_blocks>len(layers):
        raise ValueError("Cannot unfreeze more blocks than exist")
    for p in backbone.parameters():p.requires_grad_(False)
    for block in layers[-last_blocks:]:
        for p in block.parameters():p.requires_grad_(True)
    # Final layer norm also needs to adapt; first layers stay frozen.
    if hasattr(backbone,"layernorm"):
        for p in backbone.layernorm.parameters():p.requires_grad_(True)
    count=sum(p.numel() for p in backbone.parameters() if p.requires_grad)
    if count==0:raise ValueError("No trainable tail parameters")
    return count


def encode_with_tail(model, images, slice_batch, device, train):
    import torch
    from rsna_knee_dinov2 import preprocess
    if slice_batch<1:raise ValueError("slice_batch must be positive")
    features=[]
    for part in images.split(slice_batch):
        x=preprocess(part.to(device))
        if train:
            # Keep graph for final transformer blocks; no CPU detachment.
            z=model.backbone(pixel_values=x).last_hidden_state[:,0,:]
        else:
            with torch.no_grad():
                z=model.backbone(pixel_values=x).last_hidden_state[:,0,:]
        features.append(z)
    return torch.cat(features,dim=0)
