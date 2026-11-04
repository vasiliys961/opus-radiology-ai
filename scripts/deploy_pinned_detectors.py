#!/usr/bin/env python3
"""Download pinned detector weights on a capable Linux server and install their programs.

Refuses macOS and small disks before any network call or package install.
Does not read or write web/.env.local. The full scope downloads only weights
whose URL, size and SHA are already pinned, then installs the pinned Python
programs into a cache virtual environment and starts the services that can answer.
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
import zipfile
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
NODULE_REPO = "MONAI/lung_nodule_ct_detection"
NODULE_REV = "7226a40a4c3713f7d5469559b7f2fc296fd54825"
NODULE_SHA = "b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01"
# Weight SHA already checked by the nodule executor. Sidecar hashes are the
# publisher bytes at that same revision, required to start the official bundle.
NODULE_FILES = {
    "models/model.pt": (NODULE_SHA, 83709381),
    "configs/inference.json": ("d8e69c1ac4fa419181d0af3a03d5a6aef7f8f4cb1e46cfecbc4dc6879090cda3", 6991),
    "configs/metadata.json": ("614f1157323c14645423d30a3ab0f466b3dfc042d33c215360b84ad705179781", 4146),
    "scripts/__init__.py": ("0ba4210e123c4fa26feefded9d8ed35e6656992901fae0df13a4dc3823e3ef73", 804),
    "scripts/detection_inferer.py": ("420cc65c1cef882307ad5a778b45cec7d49ba44a5c8786aada849a3527c8717b", 3129),
    "scripts/detection_saver.py": ("44a90bebe51d2be547d9246899c1aa3f2361e99eb564fd8c40137f9a478d8feb", 6036),
    "scripts/evaluator.py": ("bc449e9bd9fc0e3fa298c37cf0ba4bb1fee3a199fe824703eb2c863521d84c28", 8917),
    "scripts/utils.py": ("430bf311a6bc5e47075819524455aed5e70f0bbd587cb0e23137aecf7ec228b0", 705),
}
NODULE_PROGRAMS = ("monai==1.4.0", "fastapi==0.115.12", "uvicorn==0.34.2", "psutil==6.1.1")
TOTALSEG_PROGRAMS = ("TotalSegmentator==2.18.0", "fastapi==0.115.12", "uvicorn==0.34.2")
WMH_PROGRAMS = ("wmh_seg==1.6.0", "fastapi==0.115.12", "uvicorn==0.34.2")
# Official TotalSegmentator 2.18.0 task map. Zip hashes were measured from these
# release files; the liver archive hash is also GitHub's published digest.
EFFUSION_ZIP = "https://github.com/wasserth/TotalSegmentator/releases/download/v2.0.0-weights/Dataset315_thoraxCT.zip"
EFFUSION_SHA = "974fd151df6b6755e86b34e3c7a9a11dfcee7351393f09d8621278c0aa2a5a75"
EFFUSION_BYTES = 233744954
EFFUSION_CHECKPOINT = "Dataset315_thoraxCT/nnUNetTrainer__nnUNetPlans__3d_fullres/fold_0/checkpoint_final.pth"
EFFUSION_CHECKPOINT_SHA = "c971fd018e32079a0d2abd9744f26e234d8778f6567c53ed948b22c21a1b84f0"
EFFUSION_CHECKPOINT_BYTES = 250183291
KIDNEY_ZIP = "https://github.com/wasserth/TotalSegmentator/releases/download/v2.5.0-weights/Dataset789_kidney_cyst_501subj.zip"
KIDNEY_SHA = "fd528187b1526135894ac03e15861ae4de9b39ed317fbfce06ab9066e9817425"
KIDNEY_BYTES = 230592397
KIDNEY_CHECKPOINT = "Dataset789_kidney_cyst_501subj/nnUNetTrainer_DASegOrd0_NoMirroring__nnUNetPlans__3d_fullres/fold_0/checkpoint_final.pth"
KIDNEY_CHECKPOINT_SHA = "3448f04c8617cb869462c962013fa13dd443d5f15715e2765b7c62c0c6132592"
KIDNEY_CHECKPOINT_BYTES = 246971949
LIVER_ZIP = "https://github.com/wasserth/TotalSegmentator/releases/download/v2.5.0-weights/Dataset591_ct_liver_lesions_842subj.zip"
LIVER_SHA = "b3bdd53de65dc64a46264edfdeb491b18e8f95973a691eeccfa530d1da1678a0"
LIVER_BYTES = 230940114
LIVER_CHECKPOINT = "Dataset591_ct_liver_lesions_842subj/nnUNetTrainer__nnUNetPlans__3d_fullres_high/fold_0/checkpoint_final.pth"
LIVER_CHECKPOINT_SHA = "a9cd19c9199663152ace71a32b212b2d8846cff865f9f7654891ee71bf523194"
LIVER_CHECKPOINT_BYTES = 246761278
WMH_REPO = "jil202/wmh_seg"
WMH_REV = "db9def7a0ad5b6f3347a8afdbd1bb46b42411f08"
WMH_SHA = "f7ef9747eb73ef8a927c07e4227bc4b9bfab761e0f7c60f2fd09ac9cf1a5fd3a"
WMH_BYTES = 246100637
WMH_DATASET_URL = "https://raw.githubusercontent.com/jinghangli98/wmh_seg/a5ad55c6dec7cb2d4bd7b419a3e7d0c14e72aaee/wmh_seg/nnunet_assets/invivo/dataset.json"
WMH_DATASET_SHA = "4442fd10f33a64b43f66d11b1d5dccd560b00fbe095412289057e7fe9a4acbf2"
WMH_DATASET_BYTES = 303
WMH_PLANS_URL = "https://raw.githubusercontent.com/jinghangli98/wmh_seg/a5ad55c6dec7cb2d4bd7b419a3e7d0c14e72aaee/wmh_seg/nnunet_assets/invivo/plans.json"
WMH_PLANS_SHA = "1c1566f60eddfdd28cefd3b98bd3970adf213d9aadbcf2269cee8eaf60f26174"
WMH_PLANS_BYTES = 10516
PE_REPO = "yzluka/PulmonaryEmbolismSegmentation"
PE_REV = "7ce235fc23a7cc7743973b85914658b06edb0629"
PE_SHA = "2abdbd407070c70df1b83271c25d2812770bb1cc233c6d72f1df1c5769e42188"
PE_BYTES = 566265379
PE_CONFIG_SHA = "929c85cd014627ebfad3750327fd0f512902fffb26943062a6602993e61ade32"
PE_CONFIG_BYTES = 1161
PE_VENDOR_URL = "https://github.com/mazurowski-lab/PulmonaryEmbolismSegmentation.git"
PE_VENDOR_REV = "b4c50008bbbf825282ccf10767f819276e320fb9"
BASIC = ["chest_xray_six"]
FULL = ["chest_xray_six", "chest_nodes", "lungmask_r231", "lung_nodules", "brain_hemorrhage",
        "chest_effusion", "abdomen_ct", "brain_wmh", "chest_pe"]
COMMON_PROGRAMS = ("fastapi==0.115.12", "uvicorn==0.34.2")
PINNED_PROGRAMS = {
    "chest_xray_six": ("torchxrayvision==1.5.7",),
    "chest_nodes": ("raidionicsseg==1.5.2", "lungmask==0.2.20"),
    "lung_tumor_cln": ("nnunetv2==2.7.0",),
}
TORCH_CPU = "https://download.pytorch.org/whl/cpu"


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
    if model_id == "lung_nodules":
        dest = cache / "nodule" / "lung_nodule_ct_detection"
        cached = True
        for name, (file_sha, size) in NODULE_FILES.items():
            report = fetch(publisher_file_url(NODULE_REPO, NODULE_REV, name), dest / name, file_sha, exact_size=size)
            cached = cached and report["cached"]
        return {"id": model_id, "ready": True, "sha256": NODULE_SHA, "cached": cached, "clinicalValidation": False}
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
    if model_id == "chest_effusion":
        archive = cache / "totalseg" / "Dataset315_thoraxCT.zip"
        report = fetch(EFFUSION_ZIP, archive, EFFUSION_SHA, exact_size=EFFUSION_BYTES)
        unpack_checkpoint(archive, totalseg_results(cache), EFFUSION_CHECKPOINT,
                          EFFUSION_CHECKPOINT_SHA, EFFUSION_CHECKPOINT_BYTES)
        return {"id": model_id, "ready": True, **report, "sha256": EFFUSION_CHECKPOINT_SHA, "clinicalValidation": False}
    if model_id == "abdomen_ct":
        kidney = cache / "totalseg" / "Dataset789_kidney_cyst_501subj.zip"
        liver = cache / "totalseg" / "Dataset591_ct_liver_lesions_842subj.zip"
        kidney_report = fetch(KIDNEY_ZIP, kidney, KIDNEY_SHA, exact_size=KIDNEY_BYTES)
        liver_report = fetch(LIVER_ZIP, liver, LIVER_SHA, exact_size=LIVER_BYTES)
        unpack_checkpoint(kidney, totalseg_results(cache), KIDNEY_CHECKPOINT,
                          KIDNEY_CHECKPOINT_SHA, KIDNEY_CHECKPOINT_BYTES)
        unpack_checkpoint(liver, totalseg_results(cache), LIVER_CHECKPOINT,
                          LIVER_CHECKPOINT_SHA, LIVER_CHECKPOINT_BYTES)
        return {"id": model_id, "ready": True, "sha256": LIVER_CHECKPOINT_SHA,
                "kidneySha256": KIDNEY_CHECKPOINT_SHA,
                "cached": kidney_report["cached"] and liver_report["cached"], "clinicalValidation": False}
    if model_id == "brain_wmh":
        root = cache / "wmh"
        weight = fetch(publisher_file_url(WMH_REPO, WMH_REV, "checkpoint_final_0_invivo.pth"),
                       root / "fold_0" / "checkpoint_final.pth", WMH_SHA, exact_size=WMH_BYTES)
        dataset = fetch(WMH_DATASET_URL, root / "dataset.json", WMH_DATASET_SHA, exact_size=WMH_DATASET_BYTES)
        plans = fetch(WMH_PLANS_URL, root / "plans.json", WMH_PLANS_SHA, exact_size=WMH_PLANS_BYTES)
        return {"id": model_id, "ready": True, "sha256": WMH_SHA,
                "cached": weight["cached"] and dataset["cached"] and plans["cached"], "clinicalValidation": False}
    if model_id == "chest_pe":
        root = cache / "pe"
        weight = fetch(publisher_file_url(PE_REPO, PE_REV, "pytorch_model.bin"),
                       root / "pytorch_model.bin", PE_SHA, exact_size=PE_BYTES)
        config = fetch(publisher_file_url(PE_REPO, PE_REV, "config.json"),
                       root / "config.json", PE_CONFIG_SHA, exact_size=PE_CONFIG_BYTES)
        checkout_pe(cache / "pe-vendor")
        return {"id": model_id, "ready": True, "sha256": PE_SHA,
                "cached": weight["cached"] and config["cached"], "clinicalValidation": False}
    raise ValueError("unknown_detector")


def totalseg_results(cache: Path) -> Path:
    return cache / "totalseg-home" / "nnunet" / "results"


def unpack_checkpoint(archive: Path, dest: Path, member: str, expected_sha: str, expected_size: int) -> None:
    """Extract one pinned member from an already hashed archive. Rejects paths that leave dest."""
    target = dest / member
    if target.is_file() and not target.is_symlink() and target.stat().st_size == expected_size and digest(target) == expected_sha:
        return
    if archive.is_symlink() or not archive.is_file():
        raise ValueError("pinned_archive_missing")
    parts = Path(member).parts
    if member.startswith(("/", "\\")) or Path(member).is_absolute() or not parts or any(part in ("", ".", "..") for part in parts):
        raise ValueError("checkpoint_path_escapes_archive")
    with zipfile.ZipFile(archive) as bundle:
        try:
            info = bundle.getinfo(member)
        except KeyError as error:
            raise ValueError("checkpoint_missing_from_archive") from error
        if info.is_dir() or info.file_size != expected_size:
            raise ValueError("checkpoint_size_mismatch")
        hashed = hashlib.sha256()
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = target.with_name(target.name + ".partial")
        try:
            with bundle.open(info) as source, temporary.open("wb") as output:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    hashed.update(block)
                    output.write(block)
            if hashed.hexdigest() != expected_sha:
                raise ValueError("checkpoint_sha_mismatch")
            os.chmod(temporary, 0o600)
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink(missing_ok=True)


def checkout_pe(repo: Path) -> None:
    """Pinned vendor commit. The weight file is checked separately."""
    if platform.system() != "Linux":
        raise ValueError("pe_vendor_checkout_is_linux_only")
    if repo.is_symlink():
        raise ValueError("refusing_vendor_symlink")
    if (repo / ".git").is_dir():
        current = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                                 capture_output=True, text=True, timeout=30, check=False)
        if current.returncode == 0 and current.stdout.strip() == PE_VENDOR_REV:
            return
        raise ValueError("pe_vendor_revision_mismatch")
    if repo.exists():
        raise ValueError("pe_vendor_directory_is_not_a_checkout")
    repo.mkdir(parents=True, mode=0o700)
    subprocess.run(["git", "init"], cwd=repo, check=True, timeout=30,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["git", "fetch", "--depth", "1", PE_VENDOR_URL, PE_VENDOR_REV], cwd=repo,
                   check=True, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=repo, check=True, timeout=60,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    current = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=30, check=True)
    if current.stdout.strip() != PE_VENDOR_REV:
        raise ValueError("pe_vendor_revision_mismatch")


def programs_for(model_ids: list[str]) -> list[str]:
    wanted: list[str] = []
    for model_id in model_ids:
        for spec in PINNED_PROGRAMS.get(model_id, ()):
            if spec not in wanted:
                wanted.append(spec)
    if wanted:
        for spec in COMMON_PROGRAMS:
            if spec not in wanted:
                wanted.append(spec)
    return wanted


def runtime_python(cache: Path) -> Path:
    return cache / "venv" / "bin" / "python"


def install_programs(cache: Path, model_ids: list[str]) -> str | None:
    """Install pinned programs into the cache virtual environment. Linux only."""
    specs = programs_for(model_ids)
    if not specs:
        return None
    if platform.system() != "Linux":
        return "программы ставятся только на Linux"
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    python = runtime_python(cache)
    if not python.is_file():
        subprocess.run([sys.executable, "-m", "venv", str(cache / "venv")], check=True, timeout=180)
    if any(spec.startswith(("torchxrayvision", "raidionicsseg", "lungmask", "nnunetv2")) for spec in specs):
        torch = subprocess.run(
            [str(python), "-m", "pip", "install", "--disable-pip-version-check", "torch",
             "--index-url", TORCH_CPU],
            timeout=1800, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
        if torch.returncode != 0:
            return "программа PyTorch не установилась"
    installed = subprocess.run(
        [str(python), "-m", "pip", "install", "--disable-pip-version-check", *specs],
        timeout=1800, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    if installed.returncode != 0:
        return "нужная программа не установилась"
    return None


def install_nodule_programs(cache: Path, model_ids: list[str]) -> str | None:
    """MONAI 1.4.0 needs Torch 2.4.0, so it gets its own Linux environment."""
    if "lung_nodules" not in model_ids:
        return None
    if platform.system() != "Linux":
        return "программы узлов лёгких ставятся только на Linux"
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    python = cache / "venv-nodule" / "bin" / "python"
    if not python.is_file():
        subprocess.run([sys.executable, "-m", "venv", str(cache / "venv-nodule")], check=True, timeout=180)
    torch = subprocess.run(
        [str(python), "-m", "pip", "install", "--disable-pip-version-check", "torch==2.4.0",
         "--index-url", TORCH_CPU],
        timeout=1800, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    if torch.returncode != 0:
        return "программа PyTorch 2.4.0 не установилась"
    installed = subprocess.run(
        [str(python), "-m", "pip", "install", "--disable-pip-version-check", *NODULE_PROGRAMS],
        timeout=1800, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    if installed.returncode != 0:
        return "программа monai 1.4.0 не установилась"
    return None


def _venv_install(cache: Path, folder: str, specs: tuple[str, ...], failure: str) -> str | None:
    if platform.system() != "Linux":
        return "эти программы ставятся только на Linux"
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    python = cache / folder / "bin" / "python"
    if not python.is_file():
        subprocess.run([sys.executable, "-m", "venv", str(cache / folder)], check=True, timeout=180)
    torch = subprocess.run(
        [str(python), "-m", "pip", "install", "--disable-pip-version-check", "torch",
         "--index-url", TORCH_CPU],
        timeout=1800, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    if torch.returncode != 0:
        return "программа PyTorch не установилась"
    installed = subprocess.run(
        [str(python), "-m", "pip", "install", "--disable-pip-version-check", *specs],
        timeout=3600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    if installed.returncode != 0:
        return failure
    return None


def install_totalseg_programs(cache: Path, model_ids: list[str]) -> str | None:
    if not any(model_id in model_ids for model_id in ("chest_effusion", "abdomen_ct", "chest_pe")):
        return None
    return _venv_install(cache, "venv-totalseg", TOTALSEG_PROGRAMS, "программа TotalSegmentator 2.18.0 не установилась")


def install_wmh_programs(cache: Path, model_ids: list[str]) -> str | None:
    if "brain_wmh" not in model_ids:
        return None
    return _venv_install(cache, "venv-wmh", WMH_PROGRAMS, "программа wmh_seg 1.6.0 не установилась")


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


def _packages(python: Path | None = None) -> tuple[set[str], set[str]]:
    if python is not None and python.is_file():
        probe = subprocess.run(
            [str(python), "-c",
             "import importlib.metadata,importlib.util,json,shutil,sys\n"
             "from pathlib import Path\n"
             "found=[]\n"
             "pairs=(('torchxrayvision','1.5.7'),('raidionicsseg','1.5.2'),('lungmask','0.2.20'),('nnunetv2','2.7.0'))\n"
             "for name,version in pairs:\n"
             "  try:\n"
             "    if importlib.metadata.version(name)==version: found.append(name+'=='+version)\n"
             "  except importlib.metadata.PackageNotFoundError: pass\n"
             "for name in ('fastapi','uvicorn'):\n"
             "  if importlib.util.find_spec(name): found.append(name)\n"
             "tools=['nnUNetv2_predict'] if (Path(sys.executable).parent/'nnUNetv2_predict').is_file() or shutil.which('nnUNetv2_predict') else []\n"
             "print(json.dumps({'packages':found,'tools':tools}))"],
            timeout=30, capture_output=True, text=True, check=False,
        )
        if probe.returncode == 0 and probe.stdout.strip():
            report = json.loads(probe.stdout)
            return set(report["packages"]), set(report["tools"])
    found = set()
    for name, version in (("torchxrayvision", "1.5.7"), ("raidionicsseg", "1.5.2"), ("lungmask", "0.2.20"), ("nnunetv2", "2.7.0")):
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


def _start_one(cache: Path, repo: Path, origin: str, session: dict[str, str], model_id: str, python: str) -> dict:
    if model_id == "chest_xray_six":
        key, port, probe = "OPUS_XRV_WORKER_TOKEN", 8779, "/v1/cxr/capabilities"
        weight = cache / "xrv" / "nih-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt"
        command = [python, str(repo / "services/imaging-ai/cxr_xrv_direct_worker.py"),
                   "--weights", str(weight), "--port", "8779", "--origin", origin]
        extra: dict[str, str] = {}
    elif model_id == "chest_nodes":
        key, port, probe = "OPUS_NODES_WORKER_TOKEN", 8777, "/v1/nodes/capabilities"
        command = [python, str(repo / "services/imaging-ai/raidionics_nodes_direct_worker.py"),
                   "--model-archive", str(cache / "raidionics" / "Raidionics-CT_LymphNodes-v13.zip"),
                   "--lungmask-weights", str(cache / "lungmask" / "unet_r231-d5d2fc3d.pth"),
                   "--origin", origin, "--port", "8777"]
        extra = {}
    elif model_id == "lung_nodules":
        key, port, probe = "OPUS_MONAI_WORKER_TOKEN", 8768, "/v1/nodule/capabilities"
        command = [python, str(repo / "services/imaging-ai/monai_nodule_upload_worker.py"),
                   "--bundle", str(cache / "nodule" / "lung_nodule_ct_detection"),
                   "--origin", origin, "--port", "8768", "--token-env", "OPUS_MONAI_WORKER_TOKEN"]
        extra = {}
    elif model_id == "chest_effusion":
        key, port, probe = "OPUS_EFFUSION_WORKER_TOKEN", 8774, "/v1/effusion/capabilities"
        command = [python, str(repo / "services/imaging-ai/effusion_direct_worker.py"),
                   "--checkpoint", str(totalseg_results(cache) / EFFUSION_CHECKPOINT),
                   "--checkpoint-sha256", EFFUSION_CHECKPOINT_SHA, "--origin", origin, "--port", "8774"]
        extra = {"TOTALSEG_HOME_DIR": str(cache / "totalseg-home"), "HF_HUB_OFFLINE": "1"}
    elif model_id == "abdomen_ct":
        key, port, probe = "OPUS_ABDOMEN_WORKER_TOKEN", 8775, "/v1/abdomen/capabilities"
        command = [python, str(repo / "services/imaging-ai/abdominal_ct_pathology_direct_worker.py"),
                   "--kidney-checkpoint", str(totalseg_results(cache) / KIDNEY_CHECKPOINT),
                   "--kidney-sha", KIDNEY_CHECKPOINT_SHA,
                   "--liver-checkpoint", str(totalseg_results(cache) / LIVER_CHECKPOINT),
                   "--liver-sha", LIVER_CHECKPOINT_SHA, "--origin", origin, "--port", "8775"]
        extra = {"TOTALSEG_HOME_DIR": str(cache / "totalseg-home"), "HF_HUB_OFFLINE": "1"}
    elif model_id == "brain_wmh":
        key, port, probe = "OPUS_WMH_WORKER_TOKEN", 8772, "/v1/wmh/capabilities"
        command = [python, str(repo / "services/imaging-ai/wmh_direct_dicom_worker.py"),
                   "--model-dir", str(cache / "wmh"), "--checkpoint-sha256", WMH_SHA,
                   "--origin", origin, "--port", "8772"]
        extra = {"HF_HUB_OFFLINE": "1"}
    elif model_id == "chest_pe":
        key, port, probe = "OPUS_PE_WORKER_TOKEN", 8776, "/v1/pe/capabilities"
        command = [python, str(repo / "services/imaging-ai/pe_ctpa_direct_worker.py"),
                   "--model-dir", str(cache / "pe"), "--vendor-code", str(cache / "pe-vendor"),
                   "--weights-sha", PE_SHA, "--origin", origin, "--port", "8776"]
        extra = {"HF_HUB_OFFLINE": "1"}
    else:
        key, port, probe = "OPUS_CLN_WORKER_TOKEN", 8783, "/v1/cln/capabilities"
        source = load("cln-msd-original-ct-cpu.py")
        root = cache / "cln-runtime"
        linked = root / source.TASK / source.TRAINER / "fold_0" / "checkpoint_best.pth"
        linked.parent.mkdir(parents=True, exist_ok=True)
        original = cache / "cln" / "fold_0" / "checkpoint_best.pth"
        if not linked.exists():
            os.link(original, linked)
        command = [python, str(repo / "services/imaging-ai/cln_native_upload_worker.py")]
        extra = {"OPUS_CLN_CHECKPOINT_SHA256": CLN_SHA, "OPUS_CLN_MODEL_ROOT": str(root),
                 "OPUS_CLN_WORKER_ORIGIN": origin}
    token = session.get(key) or _token()
    if not _answers(port, probe, token):
        env = os.environ.copy()
        env["PATH"] = str(Path(python).parent) + os.pathsep + env.get("PATH", "")
        env[key] = token
        env.update(extra)
        subprocess.Popen(command, env=env, start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not _wait(port, probe, token):
            return {"id": model_id, "started": False, "reason": "служба не ответила"}
    session[key] = token
    return {"id": model_id, "started": True}


def nodule_blocker(cache: Path) -> str | None:
    if platform.system() != "Linux":
        return "служба узлов лёгких запускается только на Linux"
    python = cache / "venv-nodule" / "bin" / "python"
    if not python.is_file():
        return "нет программы monai 1.4.0"
    probe = subprocess.run(
        [str(python), "-c",
         "import importlib.metadata,json\n"
         "found=[]\n"
         "pairs=(('monai','1.4.0'),('torch','2.4.0'))\n"
         "for name,version in pairs:\n"
         "  try:\n"
         "    if importlib.metadata.version(name).split('+')[0]==version: found.append(name+'=='+version)\n"
         "  except importlib.metadata.PackageNotFoundError: pass\n"
         "for name in ('fastapi','uvicorn','psutil'):\n"
         "  try:\n"
         "    importlib.metadata.version(name); found.append(name)\n"
         "  except importlib.metadata.PackageNotFoundError: pass\n"
         "print(json.dumps(found))"],
        timeout=30, capture_output=True, text=True, check=False,
    )
    if probe.returncode != 0 or not probe.stdout.strip():
        return "нет программы monai 1.4.0"
    found = set(json.loads(probe.stdout))
    if not {"monai==1.4.0", "torch==2.4.0", "fastapi", "uvicorn", "psutil"} <= found:
        return "нет программы monai 1.4.0 или torch 2.4.0"
    return None


def stack_blocker(cache: Path, folder: str, package: str, version: str, missing: str) -> str | None:
    if platform.system() != "Linux":
        return "эта служба запускается только на Linux"
    python = cache / folder / "bin" / "python"
    if not python.is_file():
        return missing
    probe = subprocess.run(
        [str(python), "-c",
         "import importlib.metadata,sys\n"
         f"got=importlib.metadata.version({package!r}).split('+')[0]\n"
         f"sys.exit(0 if got=={version!r} else 1)"],
        timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    if probe.returncode != 0:
        return missing
    return None


def start_services(cache: Path, installed: list[str], *, program_error: str | None = None,
                   nodule_error: str | None = None, totalseg_error: str | None = None,
                   wmh_error: str | None = None) -> list[dict]:
    python_path = runtime_python(cache)
    python = str(python_path if python_path.is_file() else Path(sys.executable))
    packages, tools = _packages(python_path if python_path.is_file() else None)
    session = _session(cache)
    repo = Path(__file__).resolve().parents[1]
    origin = "http://127.0.0.1:3000"
    services = []
    nodule_python = str(cache / "venv-nodule" / "bin" / "python")
    for model_id in installed:
        if model_id == "lungmask_r231":
            continue
        if model_id == "lung_nodules":
            reason = nodule_blocker(cache)
            if nodule_error and reason and reason.startswith("нет программы"):
                reason = nodule_error
            if reason:
                services.append({"id": model_id, "started": False, "reason": reason})
                continue
            try:
                services.append(_start_one(cache, repo, origin, session, model_id, nodule_python))
            except Exception as error:
                services.append({"id": model_id, "started": False, "reason": str(error)[:160]})
            continue
        if model_id in {"chest_effusion", "abdomen_ct", "chest_pe", "brain_wmh"}:
            if model_id == "brain_wmh":
                reason = stack_blocker(cache, "venv-wmh", "wmh_seg", "1.6.0", "нет программы wmh_seg 1.6.0")
                runtime = str(cache / "venv-wmh" / "bin" / "python")
                if wmh_error and reason:
                    reason = wmh_error
            else:
                reason = stack_blocker(cache, "venv-totalseg", "TotalSegmentator", "2.18.0",
                                       "нет программы TotalSegmentator 2.18.0")
                runtime = str(cache / "venv-totalseg" / "bin" / "python")
                if totalseg_error and reason:
                    reason = totalseg_error
            if reason:
                services.append({"id": model_id, "started": False, "reason": reason})
                continue
            try:
                services.append(_start_one(cache, repo, origin, session, model_id, runtime))
            except Exception as error:
                services.append({"id": model_id, "started": False, "reason": str(error)[:160]})
            continue
        reason = launch_blocker(model_id, packages, tools)
        if program_error and reason and reason.startswith("нет программы"):
            reason = program_error
        if reason:
            services.append({"id": model_id, "started": False, "reason": reason})
            continue
        try:
            services.append(_start_one(cache, repo, origin, session, model_id, python))
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
    ids = [item["id"] for item in installed]
    program_error = install_programs(cache, ids) if ids else None
    nodule_error = install_nodule_programs(cache, ids) if ids else None
    totalseg_error = install_totalseg_programs(cache, ids) if ids else None
    wmh_error = install_wmh_programs(cache, ids) if ids else None
    services = start_services(cache, ids, program_error=program_error, nodule_error=nodule_error,
                              totalseg_error=totalseg_error, wmh_error=wmh_error) if ids else []
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
