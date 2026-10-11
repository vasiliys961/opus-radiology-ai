"""Memory-bounded R231 execution using pinned Lungmask's unchanged operations.

Only preprocessing/inference/restoration are streamed. Connected-component
postprocessing still sees the complete 256x256 label volume, not separate slabs.
Heavy dependencies stay optional and are imported only in the model child.
"""
import hashlib
import importlib.metadata
import importlib.util

import numpy as np

RESUNET_SHA256 = "d72328f25a7f67c6c1896efbf30a602d5890dbc580d2cf5f2a2f72ceee63938c"


def model_source():
    """Locate SHA-pinned architecture without importing Lungmask's readers."""
    distribution = importlib.metadata.distribution("lungmask")
    if distribution.version != "0.2.20":
        raise ValueError("unsupported_lungmask_version")
    path = distribution.locate_file("lungmask/resunet.py")
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != RESUNET_SHA256:
        raise ValueError("unsupported_r231_architecture")
    return path


def unet_class():
    # Importing lungmask.resunet normally executes package __init__, which
    # eagerly imports SimpleITK and DICOM readers. Load only this verified,
    # self-contained Torch architecture module from the installed distribution.
    spec = importlib.util.spec_from_file_location("_opus_r231_resunet", model_source())
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.UNet


def load_model(weights):
    """Avoid simultaneously holding initialized and checkpoint model weights.

    The official SHA-pinned checkpoint uses legacy serialization, so mmap=True
    is unavailable. Discard initialized storage BEFORE loading the checkpoint,
    then assign its float32 CPU tensors without creating a simultaneous copy.
    The caller must verify the checkpoint SHA before calling this function.
    """
    import torch
    UNet = unet_class()

    # Direct meta construction triggers extra symbolic/meta initialization
    # imports in Torch 2.6. CPU construction followed by to_empty(meta) avoids
    # that overhead, while only ONE set of weight storage exists at any time.
    model = UNet(n_classes=3, padding=True, depth=5, up_mode="upsample",
                 batch_norm=True, residual=False)
    model.to_empty(device="meta")
    state = torch.load(str(weights), map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True, assign=True)
    if any(t.is_meta for t in (*model.parameters(), *model.buffers())):
        raise ValueError("incomplete_model_weights")
    # R231 is pinned to residual=False and inference_mode: these ReLUs have no
    # later consumer of their pre-activation input, so a second tensor is waste.
    for layer in model.modules():
        if isinstance(layer, torch.nn.ReLU):
            layer.inplace = True
        if getattr(layer, "residual", None) is False:
            # Upstream allocates these even with residual=False; they are never
            # used by this pinned network. Drop only AFTER strict state loading.
            layer.residual_input_conv = None
            layer.residual_batchnorm = None
    return model.eval()


def forward_logits(model, tensor):
    """Pinned UNet.forward, freeing each skip connection after its last use."""
    import torch

    blocks = []
    for index, down in enumerate(model.down_path):
        tensor = down(tensor)
        if index != len(model.down_path) - 1:
            blocks.append(tensor)
            tensor = torch.nn.functional.avg_pool2d(tensor, 2)
    for up in model.up_path:
        bridge = blocks.pop()
        tensor = up(tensor, bridge)
        del bridge
    return model.softmax(model.last(tensor))


def predict_slice(model, normalized):
    import torch

    # Function scope releases logits before the next slice's activations exist.
    with torch.inference_mode():
        tensor = torch.as_tensor(normalized[None, None], dtype=torch.float32, device="cpu")
        return torch.max(forward_logits(model, tensor), 1)[1][0].cpu().numpy().astype(np.uint8)


def predict_slices(volume, predict, utils):
    """Pinned clipping/cropping/normalization, one native plane at a time.

    A read-only/negative-stride memmap is accepted without a native-volume copy.
    Keep only compact predictions and crop boxes for whole-volume postprocessing.
    """
    labels = np.empty((volume.shape[0], 256, 256), dtype=np.uint8)
    boxes = []
    for index, plane in enumerate(volume):
        clipped = np.clip(plane, -1024, 600)
        resized, box = utils.crop_and_resize(clipped, width=256, height=256)
        # Match LMInferer._inference arithmetic/dtype exactly, including the
        # second clamp. No float16, alternative resize or extra downsampling.
        resized[resized > 600] = 600
        normalized = np.divide((resized + 1024), 1624)
        labels[index] = predict(normalized)
        boxes.append(box)
    return labels, boxes


def restore_slices(labels, boxes, shape, utils):
    """Restore into one uint8 allocation instead of a full float64 slice list."""
    output = np.empty(shape, dtype=np.uint8)
    for index, plane in enumerate(labels):
        output[index] = utils.reshape_mask(plane, boxes[index], shape[1:])
    return output
