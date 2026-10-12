from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def test_public_model_permissions_are_container_readable_only_after_verification():
    workflow=(ROOT/".github/workflows/totalseg-public-ct-inference.yml").read_text()
    verification=workflow.index("verify-totalsegmentator-provision.py")
    permissions=workflow.index('find "${RUNNER_TEMP}/models" -type d -exec chmod 755')
    run=workflow.index("run-totalseg-first-inference.py")
    assert verification<permissions<run
    assert 'find "${RUNNER_TEMP}/models" -type f -exec chmod 644' in workflow
    assert "network_mode: none" in (ROOT/"deploy/compose.totalseg-research.yaml").read_text()
    assert "read_only: true" in (ROOT/"deploy/compose.totalseg-research.yaml").read_text()
