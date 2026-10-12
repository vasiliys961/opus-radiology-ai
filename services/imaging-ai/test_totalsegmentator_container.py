"""Prevent the server container from omitting transitive local Python modules."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_DIR = ROOT / "services" / "imaging-ai"
DOCKERFILE = ROOT / "deploy" / "Dockerfile.totalseg-research"
RUNNER = "totalsegmentator_offline_exec"

def test_container_contains_all_local_python_imports():
    docker = DOCKERFILE.read_text()
    sources = {p.stem: p for p in MODULE_DIR.glob("*.py")}
    queue = [RUNNER]
    checked = set()
    while queue:
        module = queue.pop()
        if module in checked:
            continue
        checked.add(module)
        path = sources[module]
        assert f"COPY services/imaging-ai/{path.name} /opt/opus/{path.name}" in docker, module
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                queue.extend(alias.name for alias in node.names if alias.name in sources)
            elif isinstance(node, ast.ImportFrom) and node.module in sources:
                queue.append(node.module)

def test_container_never_exposes_inference_endpoint():
    compose = (ROOT / "deploy" / "compose.totalseg-research.yaml").read_text()
    assert "network_mode: none" in compose
    assert "ports:" not in compose
