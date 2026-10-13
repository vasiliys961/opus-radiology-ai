"""Ensure trained inference, exact public DICOM and real Chromium overlay stay opt-in."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

def test_browser_mpr_after_real_model_and_before_cleanup():
    workflow=(ROOT/".github/workflows/totalseg-full-lctsc-public-ct.yml").read_text()
    assert workflow.index('Run real 3D model')<workflow.index('Verify real lung lobe mask')
    assert workflow.index('Verify real lung lobe mask')<workflow.index('Remove reference DICOM/CT')
    assert 'upload-artifact' not in workflow
    assert 'workflow_dispatch:' in workflow

def test_source_bound_browser_overlay_not_a_mock():
    script=(ROOT/"scripts/check-totalseg-browser-mpr.mjs").read_text()
    for expected in ('slabMaskSha256','sourceFullCtSha256','setInputFiles(files)',
                     'setInputFiles(mask)','.ora-mpr-mask-overlay','threePlanesPassed:true',
                     'url.origin', 'externalBrowserNetwork:false'):
        assert expected in script
    for forbidden in ('screenshot(', 'canvas.toDataURL(', 'upload-artifact'):
        assert forbidden not in script
