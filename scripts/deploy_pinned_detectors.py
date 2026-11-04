#!/usr/bin/env python3
"""Download pinned detector weights on a capable Linux server.

Refuses macOS and small disks before any network call. Does not read or
write web/.env.local and does not start a worker. The full scope downloads
only weights whose URL, size and SHA are already pinned. It does not download
the weak pulmonary-embolism model.
"""
from __future__ import annotations
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
RAM = 16 * 1024 ** 3
DISK = 30 * 1024 ** 3
CLN_RAM = 64 * 1024 ** 3
LUNG_URL = "https://github.com/JoHof/lungmask/releases/download/v0.0/unet_r231-d5d2fc3d.pth"
LUNG_SHA = "d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f"
LUNG_MAX = 150 * 1024 * 1024
CLN_SHA = "8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87"
BASIC = ["chest_xray_six"]
FULL = ["chest_xray_six", "chest_nodes", "lungmask_r231", "brain_hemorrhage"]


def decide(system: str, ram: int, disk: int) -> str:
    if system == "Darwin":
        return "mac"
    if system != "Linux":
        return "os"
    if ram < RAM:
        return "ram"
    if disk < DISK:
        return "disk"
    return "ok"


def installs_for(scope: str, system: str, ram: int, disk: int) -> tuple[str, list[str]]:
    reason = decide(system, ram, disk)
    if reason != "ok":
        return reason, []
    if scope == "basic":
        return "ok", list(BASIC)
    if scope != "full":
        return "scope", []
    chosen = list(FULL)
    if ram >= CLN_RAM:
        chosen.append("lung_tumor_cln")
    return "ok", chosen


def digest(path: Path) -> str:
    hashed = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hashed.update(block)
    return hashed.hexdigest()


def load(name: str):
    path = Path(__file__).resolve().parent / name
    spec = importlib.util.spec_from_file_location("opus_" + name.replace("-", "_").replace(".", "_"), path)
    if spec is None or spec.loader is None:
        raise ValueError("installer_missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def publisher_file_url(repo: str, revision: str, name: str) -> str:
    if ("/" not in repo or repo.startswith("/") or ".." in repo.split("/") or
            not revision or "/" in revision or ".." in name or name.startswith("/")):
        raise ValueError("unpinned_publisher_file")
    return f"https://huggingface.co/{repo}/resolve/{revision}/{name}"


def fetch(url: str, dest: Path, expected_sha: str | None = None, *, exact_size: int | None = None, max_bytes: int | None = None) -> dict:
    if expected_sha is None and max_bytes is None:
        raise ValueError("unbounded_weight_download")
    if dest.is_symlink() or dest.parent.is_symlink():
        raise ValueError("refusing_weight_symlink")
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if dest.exists():
        size = dest.stat().st_size
        actual = digest(dest) if dest.is_file() else ""
        if not dest.is_file() or (exact_size is not None and size != exact_size) or (
            max_bytes is not None and not 0 < size <= max_bytes
        ) or (expected_sha is not None and actual != expected_sha):
            raise ValueError("cached_weight_does_not_match_pin")
        return {"cached": True, "sha256": actual, "bytes": size}
    incoming = None
    try:
        with tempfile.NamedTemporaryFile(dir=dest.parent, prefix=".weight-", delete=False) as tmp:
            incoming = Path(tmp.name)
            hashed = hashlib.sha256()
            size = 0
            with urlopen(Request(url, headers={"User-Agent": "OpusRadiologyResearch/1.0"}), timeout=180) as response:
                if str(response.geturl()).startswith("http:"):
                    raise ValueError("weight_redirect_downgraded_to_http")
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    if (exact_size is not None and size > exact_size) or (max_bytes is not None and size > max_bytes):
                        raise ValueError("weight_larger_than_pin")
                    hashed.update(block)
                    tmp.write(block)
            tmp.flush()
            os.fsync(tmp.fileno())
        actual = hashed.hexdigest()
        if (expected_sha is not None and actual != expected_sha) or (exact_size is not None and size != exact_size) or size <= 0:
            raise ValueError("weight_sha_or_size_mismatch")
        os.chmod(incoming, 0o600)
        os.replace(incoming, dest)
        incoming = None
        return {"cached": False, "sha256": actual, "bytes": size}
    finally:
        if incoming is not None:
            incoming.unlink(missing_ok=True)


def install(model_id: str, cache: Path) -> dict:
    if model_id == "chest_xray_six":
        from provision_xrv_original_model import provision
        report = provision(cache / "xrv")
        return {"id": model_id, "ready": report["ready"], "sha256": report["sha256"], "cached": report["cached"], "clinicalValidation": False}
    if model_id == "chest_nodes":
        source = load("real-raidionics-mediastinal-onnx-cpu.py")
        report = fetch(source.MODEL_URL, cache / "raidionics" / "Raidionics-CT_LymphNodes-v13.zip",
                       source.MODEL_SHA256, exact_size=source.MODEL_ARCHIVE_SIZE)
        return {"id": model_id, "ready": True, **report, "clinicalValidation": False}
    if model_id == "lungmask_r231":
        report = fetch(LUNG_URL, cache / "lungmask" / "unet_r231-d5d2fc3d.pth", LUNG_SHA, max_bytes=LUNG_MAX)
        return {"id": model_id, "ready": True, **report, "clinicalValidation": False}
    if model_id == "brain_hemorrhage":
        source = load("run-ianpan-ich-research.py")
        dest = cache / "ich"
        cached = True
        for name, (file_sha, size) in source.MODEL_FILES.items():
            report = fetch(publisher_file_url(source.MODEL_REPO, source.MODEL_REV, name),
                           dest / name, file_sha, exact_size=size)
            cached = cached and report["cached"]
        source.obtain_model(dest, download=False)
        return {"id": model_id, "ready": True, "cached": cached, "clinicalValidation": False}
    if model_id == "lung_tumor_cln":
        source = load("cln-msd-original-ct-cpu.py")
        dest = cache / "cln"
        cached = True
        for name in source.FILES:
            target = dest / ("fold_0/checkpoint_best.pth" if name == "checkpoint_best.pth"
                             else "plans.json" if name == "nnUNetPlans.json" else name)
            report = fetch(publisher_file_url(source.REPO, source.REVISION, name), target,
                           CLN_SHA if name == "checkpoint_best.pth" else None,
                           max_bytes=source.MAX_FILE_BYTES)
            cached = cached and report["cached"]
            if name == "checkpoint_best.pth" and report["sha256"] != CLN_SHA:
                raise ValueError("lung_tumor_checkpoint_sha_mismatch")
        source.check_publisher_metadata(
            json.loads((dest / "dataset.json").read_text()),
            json.loads((dest / "plans.json").read_text()))
        return {"id": model_id, "ready": True, "sha256": CLN_SHA, "cached": cached, "clinicalValidation": False}
    raise ValueError("unknown_detector")


def launch_blocker(model_id: str, packages: set[str], tools: set[str]) -> str | None:
    if model_id == "brain_hemorrhage":
        return "эта служба считает только заранее разрешённое публичное исследование"
    if model_id == "chest_xray_six" and "torchxrayvision==1.5.7" not in packages:
        return "нет программы torchxrayvision 1.5.7"
    if model_id == "chest_nodes" and not {"raidionicsseg==1.5.2", "lungmask==0.2.20"} <= packages:
        return "нет программы raidionicsseg 1.5.2 или lungmask 0.2.20"
    if model_id == "lung_tumor_cln" and "nnUNetv2_predict" not in tools:
        return "нет программы nnUNetv2_predict"
    if model_id in {"chest_xray_six", "chest_nodes", "lung_tumor_cln"} and not {"fastapi", "uvicorn"} <= packages:
        return "нет программы fastapi или uvicorn"
    return None


def _packages() -> tuple[set[str], set[str]]:
    found = set()
    for name, version in (("torchxrayvision", "1.5.7"), ("raidionicsseg", "1.5.2"), ("lungmask", "0.2.20")):
        try:
            if importlib.metadata.version(name) == version:
                found.add(name + "==" + version)
        except importlib.metadata.PackageNotFoundError:
            pass
    for name in ("fastapi", "uvicorn"):
        if importlib.util.find_spec(name):
            found.add(name)
    tools = {"nnUNetv2_predict"} if shutil.which("nnUNetv2_predict") else set()
    return found, tools


def _token() -> str:
    value = secrets.token_urlsafe(48).replace("-", "_")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", value):
        raise ValueError("bad_loopback_token")
    return value


def _answers(port: int, path: str, token: str) -> bool:
    request = Request(
        f"http://127.0.0.1:{port}{path}",
        headers={"Authorization": "Bearer " + token, "Origin": "http://127.0.0.1:3000"},
    )
    try:
        with urlopen(request, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def _wait(port: int, path: str, token: str) -> bool:
    for _ in range(20):
        if _answers(port, path, token):
            return True
        time.sleep(0.5)
    return False


def _session(cache: Path) -> dict[str, str]:
    try:
        data = json.loads((cache / "loopback-session.json").read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    workers = data.get("workers") if isinstance(data, dict) else None
    if not isinstance(workers, dict):
        return {}
    return {key: value for key, value in workers.items()
            if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{32,128}", value)}


def _save_session(cache: Path, workers: dict[str, str]) -> None:
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = cache / "loopback-session.json"
    temporary = cache / ".loopback-session.json"
    temporary.write_text(json.dumps({"schema": "opus-loopback-session/v1", "workers": workers}))
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)
    os.chmod(target, 0o600)


def _start_one(cache: Path, repo: Path, origin: str, session: dict[str, str], model_id: str) -> dict:
    if model_id == "chest_xray_six":
        key, port, probe = "OPUS_XRV_WORKER_TOKEN", 8779, "/v1/cxr/capabilities"
        weight = cache / "xrv" / "nih-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt"
        command = [sys.executable, str(repo / "services/imaging-ai/cxr_xrv_direct_worker.py"),
                   "--weights", str(weight), "--port", "8779", "--origin", origin]
        extra: dict[str, str] = {}
    elif model_id == "chest_nodes":
        key, port, probe = "OPUS_NODES_WORKER_TOKEN", 8777, "/v1/nodes/capabilities"
        command = [sys.executable, str(repo / "services/imaging-ai/raidionics_nodes_direct_worker.py"),
                   "--model-archive", str(cache / "raidionics" / "Raidionics-CT_LymphNodes-v13.zip"),
                   "--lungmask-weights", str(cache / "lungmask" / "unet_r231-d5d2fc3d.pth"),
                   "--origin", origin, "--port", "8777"]
        extra = {}
    else:
        key, port, probe = "OPUS_CLN_WORKER_TOKEN", 8783, "/v1/cln/capabilities"
        source = load("cln-msd-original-ct-cpu.py")
        root = cache / "cln-runtime"
        linked = root / source.TASK / source.TRAINER / "fold_0" / "checkpoint_best.pth"
        linked.parent.mkdir(parents=True, exist_ok=True)
        original = cache / "cln" / "fold_0" / "checkpoint_best.pth"
        if not linked.exists():
            os.link(original, linked)
        command = [sys.executable, str(repo / "services/imaging-ai/cln_native_upload_worker.py")]
        extra = {"OPUS_CLN_CHECKPOINT_SHA256": CLN_SHA, "OPUS_CLN_MODEL_ROOT": str(root),
                 "OPUS_CLN_WORKER_ORIGIN": origin}
    token = session.get(key) or _token()
    if not _answers(port, probe, token):
        env = os.environ.copy()
        env[key] = token
        env.update(extra)
        subprocess.Popen(command, env=env, start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not _wait(port, probe, token):
            return {"id": model_id, "started": False, "reason": "служба не ответила"}
    session[key] = token
    return {"id": model_id, "started": True}


def start_services(cache: Path, installed: list[str]) -> list[dict]:
    packages, tools = _packages()
    session = _session(cache)
    repo = Path(__file__).resolve().parents[1]
    origin = "http://127.0.0.1:3000"
    services = []
    for model_id in installed:
        if model_id == "lungmask_r231":
            continue
        reason = launch_blocker(model_id, packages, tools)
        if reason:
            services.append({"id": model_id, "started": False, "reason": reason})
            continue
        try:
            services.append(_start_one(cache, repo, origin, session, model_id))
        except Exception as error:
            services.append({"id": model_id, "started": False, "reason": str(error)[:160]})
    if any(item["started"] for item in services):
        try:
            _save_session(cache, session)
        except OSError:
            for item in services:
                if item.get("started"):
                    item["started"] = False
                    item["reason"] = "ключ службы не сохранён"
    return services


def main() -> int:
    scope = sys.argv[1] if len(sys.argv) == 2 else ""
    system = platform.system()
    ram = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    cache = Path(os.environ.get("OPUS_MODEL_CACHE", str(Path.home() / ".cache/opus-radiology/original-models"))).expanduser()
    disk = shutil.disk_usage(cache.parent if cache.parent.exists() else Path.home()).free
    reason, chosen = installs_for(scope, system, ram, disk)
    if reason != "ok":
        print(json.dumps({"eligible": False, "reason": reason, "installed": [], "failed": []}))
        return 2
    installed, failed = [], []
    for model_id in chosen:
        try:
            installed.append(install(model_id, cache))
        except Exception as error:
            failed.append({"id": model_id, "message": str(error)[:200]})
    services = start_services(cache, [item["id"] for item in installed]) if installed else []
    print(json.dumps({
        "eligible": not failed, "reason": "ok" if not failed else "download_failed",
        "installed": installed, "failed": failed, "services": services,
        "clinicalValidation": False}))
    return 0 if not failed else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"eligible": False, "reason": "download_failed", "message": str(error)[:300], "installed": [], "failed": []}))
        raise SystemExit(1)
