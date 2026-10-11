"""Streaming arithmetic/geometry checks; synthetic labels are not model evidence."""
from types import SimpleNamespace

import numpy as np
import pytest

from r231_inference import forward_logits, model_source, predict_slices, restore_slices, unet_class


def labels_from_scalars(plane):
    return np.where(plane < 0.3, 1, np.where(plane > 0.6, 2, 0)).astype(np.uint8)


@pytest.mark.parametrize("reverse", [False, True])
def test_readonly_native_memmap_streams_exact_normalization_and_restoration(tmp_path, reverse):
    original = np.linspace(-1800, 1200, 3 * 64 * 64, dtype=np.float32).reshape(3, 64, 64)
    path = tmp_path / "scalars.raw"
    original.tofile(path)
    volume = np.memmap(path, dtype=np.float32, mode="r", shape=original.shape)
    if reverse:
        volume = volume[::-1, ::-1, ::-1]
    calls = []

    def crop(plane, width, height):
        calls.append(plane.shape)
        # Test utility only: the production path calls pinned Lungmask utilities.
        box = (4, 5, 60, 59)
        return np.resize(plane[4:60, 5:59], (height, width)), box

    def restore(plane, box, shape):
        out = np.zeros(shape, dtype=np.float64)
        out[box[0]:box[2], box[1]:box[3]] = np.resize(plane, (box[2]-box[0], box[3]-box[1]))
        return out

    utils = SimpleNamespace(crop_and_resize=crop, reshape_mask=restore)
    actual, boxes = predict_slices(volume, labels_from_scalars, utils)
    assert calls == [(64, 64)] * 3  # native-volume copy/clip is never requested
    # Independent baseline uses full-volume clipping and a float64 restoration
    # list, like upstream. Streaming must preserve values, order and crop boxes.
    baseline_planes, baseline_boxes = zip(*(crop(p, 256, 256) for p in np.clip(volume.copy(), -1024, 600)))
    baseline = np.asarray(baseline_planes)
    baseline[baseline > 600] = 600
    baseline = np.divide((baseline + 1024), 1624)
    np.testing.assert_array_equal(actual, labels_from_scalars(baseline))
    assert boxes == list(baseline_boxes)
    result = restore_slices(actual, boxes, volume.shape, utils)
    expected = np.asarray([restore(p, b, volume.shape[1:]) for p, b in zip(actual, boxes)], dtype=np.uint8)
    assert result.dtype == np.uint8 and result.shape == original.shape
    np.testing.assert_array_equal(result, expected)
    assert path.read_bytes() == original.tobytes()  # source stays untouched


def test_pinned_upstream_preprocessing_equivalence_when_optional_stack_installed():
    utils = pytest.importorskip("lungmask.utils")
    import r231_lungmask_utils as local_utils
    volume = np.full((3, 128, 128), -1500, dtype=np.float32)
    volume[:, 10:110, 18:115] = 40
    volume[1, 32:96, 32:96] = 900
    streamed, boxes = predict_slices(volume, labels_from_scalars, local_utils)
    baseline, baseline_boxes = utils.preprocess(volume, resolution=[256, 256])
    baseline[baseline > 600] = 600
    baseline = np.divide((baseline + 1024), 1624)
    np.testing.assert_array_equal(streamed, labels_from_scalars(baseline))
    np.testing.assert_array_equal(boxes, baseline_boxes)
    expected = np.asarray([utils.reshape_mask(p, b, volume.shape[1:]) for p, b in zip(streamed, boxes)], dtype=np.uint8)
    np.testing.assert_array_equal(restore_slices(streamed, boxes, volume.shape, local_utils), expected)
    np.testing.assert_array_equal(local_utils.postprocessing(streamed, disable_tqdm=True),
                                  utils.postprocessing(streamed, disable_tqdm=True))


def test_released_skip_connections_and_inplace_relu_preserve_logits():
    torch = pytest.importorskip("torch")
    pytest.importorskip("lungmask.resunet")
    UNet = unet_class()
    torch.set_num_threads(1)
    # Small random-weight architecture check, not a trained-model test.
    model = UNet(n_classes=3, padding=True, depth=5, wf=2, up_mode="upsample",
                 batch_norm=True, residual=False).eval()
    tensor = torch.linspace(-1, 1, 64*64).reshape(1, 1, 64, 64)
    with torch.inference_mode():
        expected = model(tensor)
        for layer in model.modules():
            if isinstance(layer, torch.nn.ReLU):
                layer.inplace = True
        actual = forward_logits(model, tensor)
    torch.testing.assert_close(actual, expected, rtol=0, atol=0)


def test_architecture_corruption_is_rejected_without_importing_it(tmp_path, monkeypatch):
    source = tmp_path / "resunet.py"
    source.write_text("raise AssertionError('must not execute')")
    distribution = SimpleNamespace(version="0.2.20", locate_file=lambda _: source)
    monkeypatch.setattr("r231_inference.importlib.metadata.distribution", lambda _: distribution)
    with pytest.raises(ValueError, match="unsupported_r231_architecture"):
        model_source()
