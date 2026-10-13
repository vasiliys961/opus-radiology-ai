"""Synthetic geometry-only tests: no clinical CT, no pretrained inference."""
import importlib.util
from pathlib import Path
import pytest
spec = importlib.util.spec_from_file_location('geom', Path(__file__).with_name('nodule_source_geometry.py'))
geom = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geom)
HEADER = """NDims = 3
DimSize = 10 20 30
ElementSpacing = 0.7 0.9 2.5
Offset = -100 24 41
TransformMatrix = 0 -1 0 1 0 0 0 0 1
"""

def test_nonidentity_orientation_and_anisotropic_round_trip():
    g = geom.geometry_from_mhd(HEADER)
    index = (3.0, 5.0, 7.0)
    point = geom.source_index_to_physical(g, index)
    assert point == pytest.approx((-104.5, 26.1, 58.5))
    assert geom.physical_to_source_index(g, point) == pytest.approx(index)
    assert 'not yet verified' in g['sourceFrame']

@pytest.mark.parametrize('header', [
    HEADER.replace('TransformMatrix = 0 -1 0 1 0 0 0 0 1', ''),
    HEADER.replace('0 -1 0 1 0 0 0 0 1', '0 0 0 0 0 0 0 0 0'),
    HEADER.replace('Offset = -100 24 41', 'Offset = -100 24 41\nOrigin = 0 0 0'),
    HEADER.replace('ElementSpacing = 0.7', 'ElementSpacing = -0.7'),
    HEADER.replace('NDims = 3', 'NDims = 2'),
])
def test_invalid_source_geometry_refuses(header):
    with pytest.raises(ValueError):
        geom.geometry_from_mhd(header)

def test_candidate_world_point_never_becomes_verified_dicom_location():
    result = geom.unverified_candidate((1, 2, 3))
    assert result['coordinateFrameVerifiedAgainstSource'] is False
    assert result['nativeSourceIndex'] is None
    assert result['dicomLpsMm'] is None
    assert result['sopInstanceUid'] is None
    g = geom.geometry_from_mhd(HEADER)
    with pytest.raises(ValueError, match='outside_source'):
        geom.physical_to_source_index(g, (9000, 0, 0))
