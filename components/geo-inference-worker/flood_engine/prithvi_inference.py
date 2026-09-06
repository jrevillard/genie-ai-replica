"""
Prithvi-EO-2.0-300M-TL-Sen1Floods11 flood segmentation.

Input:  6-band Sentinel-2 GeoTIFF (B2, B3, B4, B8A, B11, B12), reflectance ×10000.
Output: uint8 GeoTIFF — 0=land, 1=flood/water, 255=nodata.

Models are downloaded on first call to the HuggingFace hub cache (HF_HOME env var).
Subsequent calls reuse the cached files.
"""
from __future__ import annotations

import logging
import os
import sys
import tempfile
import types
from pathlib import Path

log = logging.getLogger(__name__)

MODEL_REPO      = os.getenv("PRITHVI2_MODEL_REPO", "ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11")
_CONFIG_FILE    = "config.yaml"
_CHECKPOINT_FILE = "Prithvi-EO-V2-300M-TL-Sen1Floods11.pt"
_NODATA         = 255
# S2 band subset Prithvi expects — indices 0-based into the 6-band input
_BAND_INDICES   = [0, 1, 2, 3, 4, 5]
_TILE_SIZE      = 512


# ---------------------------------------------------------------------------
# mmcv.ops compatibility shim (Python 3.11 + mmcv 1.7.2 in CPU env)
# ---------------------------------------------------------------------------

def _install_mmcv_ops_compat() -> None:
    try:
        import mmcv
    except ImportError:
        return
    try:
        import mmcv.ops  # noqa: F401 — already available
        return
    except Exception:
        pass

    ops = types.ModuleType("mmcv.ops")

    def sigmoid_focal_loss(pred, target, gamma=2.0, alpha=0.25, weight=None, reduction="mean"):
        import torch.nn.functional as F
        sig = pred.sigmoid()
        target = target.type_as(pred)
        pt = (1 - sig) * target + sig * (1 - target)
        fw = (alpha * target + (1 - alpha) * (1 - target)) * pt.pow(gamma)
        loss = F.binary_cross_entropy_with_logits(pred, target, reduction="none") * fw
        if weight is not None:
            loss = loss * weight
        return loss.sum() if reduction == "sum" else loss.mean() if reduction == "mean" else loss

    def point_sample(input, points, align_corners=False, **kwargs):
        import torch.nn.functional as F
        if points.dim() == 3:
            points = points.unsqueeze(2)
        return F.grid_sample(input, points * 2 - 1, align_corners=align_corners, **kwargs)

    class _Unavailable:
        def __init__(self, *a, **kw):
            raise RuntimeError("mmcv compiled op not available in this environment")

    ops.sigmoid_focal_loss = sigmoid_focal_loss
    ops.point_sample       = point_sample
    ops.PSAMask            = _Unavailable
    ops.CrissCrossAttention = _Unavailable
    ops.get_onnxruntime_op_path = lambda: ""
    sys.modules["mmcv.ops"] = ops
    import mmcv as _mmcv
    setattr(_mmcv, "ops", ops)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _choose_device(device_arg: str = "cpu"):
    import torch
    if device_arg == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(device_arg)


def _download_model():
    from huggingface_hub import hf_hub_download
    config = hf_hub_download(repo_id=MODEL_REPO, filename=_CONFIG_FILE)
    ckpt   = hf_hub_download(repo_id=MODEL_REPO, filename=_CHECKPOINT_FILE)
    return config, ckpt


def _disable_pretrained(config_path: str) -> str:
    """Write a temp config with all pretrained backbone flags disabled."""
    import yaml

    def _walk(v):
        changed = False
        if isinstance(v, dict):
            for k, child in list(v.items()):
                if k in {"pretrained", "backbone_pretrained"} and child is not False:
                    v[k] = False; changed = True
                elif k in {"pretrained_cfg", "pretrained_path", "pretrained_weights",
                           "checkpoint_path", "backbone_checkpoint"} and child:
                    v[k] = None; changed = True
                else:
                    changed = _walk(child) or changed
        elif isinstance(v, list):
            for child in v:
                changed = _walk(child) or changed
        return changed

    cfg = yaml.safe_load(Path(config_path).read_text())
    if not _walk(cfg):
        return config_path
    tmp = Path(tempfile.mkdtemp(prefix="prithvi_cfg_")) / "config.yaml"
    tmp.write_text(yaml.safe_dump(cfg, sort_keys=False))
    return str(tmp)


def _load_geotiff(path: Path):
    import numpy as np
    import rasterio as rio
    with rio.open(path) as src:
        data    = src.read().astype(np.float32)
        profile = src.profile.copy()
        nodata  = src.nodata

    nodata_mask = np.zeros(data.shape[1:], dtype=bool)
    if nodata is not None:
        nodata_mask = np.any(data == nodata, axis=0)
        data = np.where(data == nodata, 0, data)

    if np.nanmax(data) > 2.0:
        data = data / 10000.0
    data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)
    # shape: (1, bands, 1, H, W) — Prithvi temporal dim = 1
    data = data[np.newaxis, :, np.newaxis, :, :]
    return data, nodata_mask, profile


def _run_model(config_path, ckpt_path, image, device, tile_size=_TILE_SIZE):
    import torch
    from einops import rearrange
    from terratorch.cli_tools import LightningInferenceModel

    runtime_cfg = _disable_pretrained(config_path)
    lm    = LightningInferenceModel.from_config(runtime_cfg, ckpt_path)
    model = lm.model.to(device)
    model.eval()

    image = torch.from_numpy(image).float()
    image = rearrange(image, "b c t h w -> b h w (c t)")
    _, H, W, C = image.shape

    # Pad to tile_size multiples
    ph = (tile_size - H % tile_size) % tile_size
    pw = (tile_size - W % tile_size) % tile_size
    mode = "reflect" if ph < H and pw < W else "replicate"
    image = torch.nn.functional.pad(image, (0, 0, 0, pw, 0, ph), mode=mode)
    _, PH, PW, _ = image.shape

    patches = image.unfold(1, tile_size, tile_size).unfold(2, tile_size, tile_size)
    patches = patches.contiguous().view(-1, tile_size, tile_size, C)

    processed = [lm.datamodule.test_transform(image=p.numpy())["image"] for p in patches]
    data = torch.stack(processed).to(device).unsqueeze(2)

    aug = getattr(lm.datamodule, "aug", None)
    if aug is not None:
        try:
            data = aug(data, data_keys=["input"])
        except Exception:
            try:
                data = aug(data)
            except Exception:
                pass

    preds = []
    with torch.no_grad():
        for batch in data.split(1):
            out = model(batch, temporal_coords=None, location_coords=None)
            preds.append(out.output.argmax(dim=1).cpu())

    preds = torch.cat(preds, dim=0)
    preds = preds.view(1, PH // tile_size, PW // tile_size, tile_size, tile_size)
    preds = preds.permute(0, 1, 3, 2, 4).contiguous().view(1, PH, PW)
    return preds[0, :H, :W].numpy().astype("uint8")


def run_flood_inference(input_tif: Path, output_tif: Path, device: str = "cpu") -> None:
    """
    Run Prithvi-EO-2.0 flood segmentation.

    Writes a uint8 GeoTIFF: 0=land, 1=flood/water, 255=nodata.
    Downloads the model from HuggingFace if not already cached.
    """
    import numpy as np
    import rasterio as rio

    _install_mmcv_ops_compat()

    log.info("Loading Prithvi-EO-2.0 model (downloads from HF on first run)…")
    config_path, ckpt_path = _download_model()
    log.info("Model ready — config=%s", config_path)

    dev = _choose_device(device)
    log.info("Inference device: %s", dev)

    image, nodata_mask, profile = _load_geotiff(input_tif)
    pred = _run_model(config_path, ckpt_path, image, dev)

    # Apply nodata mask
    pred[nodata_mask] = _NODATA

    profile.update(count=1, dtype=rio.uint8, nodata=_NODATA, compress="zstd")
    output_tif.parent.mkdir(parents=True, exist_ok=True)
    with rio.open(output_tif, "w", **profile) as dst:
        dst.write(pred, 1)
        dst.set_band_description(1, "Prithvi-EO-2.0 flood: 0=land, 1=flood/water, 255=nodata")

    flood_px = int((pred == 1).sum())
    valid_px = int((pred != _NODATA).sum())
    pct = 100.0 * flood_px / valid_px if valid_px else 0.0
    log.info("Flood inference complete — %d/%d valid px flooded (%.2f%%)", flood_px, valid_px, pct)
