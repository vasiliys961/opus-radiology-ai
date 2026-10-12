"""Read-only preparation for a future isolated CT adapter; never runs/downloads a model."""
import hashlib
import importlib.metadata
import json
import os
import stat
from pathlib import Path

VERSION = '2.18.0'
SOURCE_COMMIT = '3b9b7a1b2df13bacd1de41a8da2e8cdb6f13df5b'
LUNG_LOBES = {10:'lung_upper_lobe_left',11:'lung_lower_lobe_left',12:'lung_upper_lobe_right',
              13:'lung_middle_lobe_right',14:'lung_lower_lobe_right'}
DATASETS = {297:'Dataset297_TotalSegmentator_total_3mm_1559subj',
            298:'Dataset298_TotalSegmentator_total_6mm_1559subj'}
TRAINER = 'nnUNetTrainer_4000epochs_NoMirroring__nnUNetPlans__3d_fullres'
MAX_FILE_BYTES = 600 * 1024**2


def plan(modality, task='total', roi=None):
    if modality != 'CT' or task != 'total':
        raise ValueError('unsupported_modality_or_task')
    if roi is not None and not isinstance(roi,list):
        raise ValueError('unsupported_roi')
    selected = list(LUNG_LOBES.values()) if roi is None else list(roi)
    if (not selected or any(not isinstance(name,str) or name not in LUNG_LOBES.values() for name in selected)
            or len(set(selected)) != len(selected)):
        raise ValueError('unsupported_roi')
    return {'packageVersion':VERSION,'sourceCommit':SOURCE_COMMIT,'task':'total','device':'cpu',
            'fast':True,'roiSubset':selected,'requiredDatasetIds':[297,298],
            'modelSpacingMm':3,'cropModelSpacingMm':6,'nativeOutputRequired':True,
            'labels':[{'id':i,'name':name} for i,name in LUNG_LOBES.items() if name in selected],
            'limitations':['Anatomical segmentation, not a pathology detector.',
                           'Fast inference resamples to 3 mm; ROI localization uses another 6 mm checkpoint.',
                           'M1 memory/performance and output geometry are not yet accepted.']}


def file_record(root, relative):
    """Hash one untrusted local file without following symlinks.

    This is a filesystem integrity check, not proof of official model provenance.
    Each directory is opened relative to its already-open parent to prevent
    symlink replacement between validation and reading.
    """
    parts = Path(relative).parts
    if (not parts or Path(relative).is_absolute()
            or any(p in ('', '.', '..') for p in parts)):
        return {'file': relative, 'status': 'rejected-path'}
    fds = []
    try:
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        fds.append(directory)
        for name in parts[:-1]:
            directory = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            fds.append(directory)
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        fds.append(fd)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            return {'file': relative, 'status': 'rejected-type'}
        size = before.st_size
        if size <= 0 or size > MAX_FILE_BYTES:
            return {'file': relative, 'status': 'rejected-size'}
        digest = hashlib.sha256()
        read_bytes = 0
        while block := os.read(fd, 128 * 1024):
            read_bytes += len(block)
            if read_bytes > size or read_bytes > MAX_FILE_BYTES:
                return {'file': relative, 'status': 'changed-during-audit'}
            digest.update(block)
        after = os.fstat(fd)
        if (read_bytes != size or before.st_size != after.st_size
                or before.st_mtime_ns != after.st_mtime_ns
                or before.st_ctime_ns != after.st_ctime_ns
                or before.st_ino != after.st_ino):
            return {'file': relative, 'status': 'changed-during-audit'}
        return {'file': relative, 'status': 'present-unverified',
                'bytes': size, 'sha256': digest.hexdigest()}
    except FileNotFoundError:
        return {'file': relative, 'status': 'missing'}
    except OSError:
        return {'file': relative, 'status': 'rejected-symlink-or-unsafe-file'}
    finally:
        for fd in reversed(fds):
            os.close(fd)


def audit(weights_root, config_path, installed_version=None):
    # metadata.version does not import Torch/TotalSegmentator or execute its setup.
    if installed_version is None:
        try:
            installed_version = importlib.metadata.version('TotalSegmentator')
        except importlib.metadata.PackageNotFoundError:
            installed_version = 'not-installed'
    package = 'version-matched' if installed_version == VERSION else 'missing-or-incompatible'
    root = Path(weights_root).absolute()
    files = []
    for folder in DATASETS.values():
        for suffix in ['plans.json','dataset.json','fold_0/checkpoint_final.pth']:
            files.append(file_record(root,f'{folder}/{TRAINER}/{suffix}'))
    telemetry = 'unverified'
    config_path = Path(config_path)
    if config_path.is_file() and not config_path.is_symlink() and config_path.stat().st_size <= 8192:
        try:
            config = json.loads(config_path.read_text())
            if isinstance(config,dict) and config.get('send_usage_stats') is False:
                telemetry = 'disabled-in-local-config'
        except (OSError,ValueError):
            pass
    return {'schema':'opus-totalsegmentator-install-audit/v1','plan':plan('CT'),
            'packageStatus':package,'files':files,'telemetryStatus':telemetry,
            'adapterConnected':False,'canRun':False,'clinicalStatus':'not-validated',
            'remainingGates':['Independent official checkpoint SHA/licence curation (local hashes alone are not trusted).',
                              'Isolated adapter with hard no-network/download enforcement and resource watchdog.',
                              'Original-grid output/SHA/Evidence/MPR and actual public-reference benchmark.',
                              'Mac M1/Safari/system memory and clinical validation.']}
