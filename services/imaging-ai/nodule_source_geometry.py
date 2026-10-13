"""Research-only MetaImage geometry checks for lung nodule source binding.

A model-reported 'world' coordinate is not automatically a source voxel,
DICOM LPS coordinate, or a verified clinical detection.
"""
from __future__ import annotations
import math
from typing import Sequence

def _triplet(values: Sequence[float], name: str) -> tuple[float, float, float]:
    if len(values) != 3 or any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
        raise ValueError(f"invalid_{name}")
    return tuple(float(v) for v in values)

def geometry_from_mhd(text: str) -> dict:
    """Extract source geometry only; no MONAI->source frame assertion."""
    fields = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise ValueError('invalid_mhd_header')
        k, v = (part.strip() for part in line.split('=', 1))
        if k in fields:
            raise ValueError('duplicate_mhd_field')
        fields[k] = v
    if fields.get('NDims') != '3':
        raise ValueError('unsupported_dimensions')
    dims_raw = fields.get('DimSize', '').split()
    if len(dims_raw) != 3 or any(not v.isascii() or not v.isdecimal() for v in dims_raw):
        raise ValueError('invalid_dimensions')
    dims = tuple(int(v) for v in dims_raw)
    if any(v < 1 or v > 10000 for v in dims):
        raise ValueError('invalid_dimensions')
    spacing = _triplet([float(x) for x in fields.get('ElementSpacing', '').split()], 'spacing')
    if any(v <= 0 or v > 100 for v in spacing):
        raise ValueError('invalid_spacing')
    origin_keys = [k for k in ('Offset', 'Position', 'Origin') if k in fields]
    if len(origin_keys) != 1:
        raise ValueError('ambiguous_or_missing_origin')
    origin = _triplet([float(x) for x in fields[origin_keys[0]].split()], 'origin')
    matrix_values = [float(x) for x in fields.get('TransformMatrix', '').split()]
    if len(matrix_values) != 9 or not all(math.isfinite(v) for v in matrix_values):
        raise ValueError('missing_or_invalid_transform')
    matrix = [matrix_values[i:i+3] for i in (0, 3, 6)]
    for row in matrix:
        if abs(sum(x*x for x in row) - 1) > 1e-4:
            raise ValueError('invalid_direction_cosines')
    for i in range(3):
        for j in range(i+1, 3):
            if abs(sum(matrix[k][i]*matrix[k][j] for k in range(3))) > 1e-4:
                raise ValueError('invalid_direction_cosines')
    return {'dimensions': dims, 'spacingMm': spacing, 'origin': origin,
            'directionMatrix': matrix, 'sourceFrame': 'MetaImage physical frame (DICOM LPS not yet verified)'}

def source_index_to_physical(geometry: dict, index: Sequence[float]) -> tuple[float, float, float]:
    idx = _triplet(index, 'voxel_index')
    if any(v < 0 or v >= geometry['dimensions'][i] for i, v in enumerate(idx)):
        raise ValueError('voxel_outside_source')
    scaled = [idx[i] * geometry['spacingMm'][i] for i in range(3)]
    return tuple(geometry['origin'][r] + sum(geometry['directionMatrix'][r][c] * scaled[c] for c in range(3)) for r in range(3))

def physical_to_source_index(geometry: dict, physical: Sequence[float]) -> tuple[float, float, float]:
    pt = _triplet(physical, 'physical_point')
    delta = [pt[i] - geometry['origin'][i] for i in range(3)]
    index = tuple(sum(geometry['directionMatrix'][r][c]*delta[r] for r in range(3))/geometry['spacingMm'][c] for c in range(3))
    if any(v < -1e-4 or v > geometry['dimensions'][i]-1+1e-4 for i, v in enumerate(index)):
        raise ValueError('physical_point_outside_source')
    return index

def unverified_candidate(model_world_center: Sequence[float]) -> dict:
    """Do not reinterpret model output as source/DICOM coordinates without separately tested mapping."""
    center = _triplet(model_world_center, 'model_world_center')
    return {'centerMonaiWorldMm': center, 'nativeSourceIndex': None,
            'dicomLpsMm': None, 'sopInstanceUid': None,
            'coordinateFrameVerifiedAgainstSource': False,
            'reason': 'MONAI world-to-source frame transform not independently verified'}
