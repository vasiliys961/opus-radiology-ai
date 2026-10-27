#!/usr/bin/env python3
"""Contract checks for public ICH worker. NO trained model execution in CI."""
import importlib.util
from pathlib import Path

p=Path(__file__).resolve().parents[1]/"services/imaging-ai/ich_public_worker.py"
spec=importlib.util.spec_from_file_location("opus_ich_public_worker",p)
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

for allowed in ("http://localhost:3000","http://127.0.0.1:3000"):
 worker.check_origin(allowed)
for denied in ("https://localhost:3000","http://example.com:3000",
               "http://localhost:3000/unsafe","http://localhost",
               "http://user:password@localhost:3000","http://localhost:3000?key=1"):
 try:worker.check_origin(denied)
 except ValueError:pass
 else:raise AssertionError("unsafe_ORIGIN_accepted")

shas=[f"{i:064x}" for i in range(8)]
payload={"schema":"opus-public-ich-job/v1","dataPolicy":"public-reference-only",
         "originalDicomSha256":list(reversed(shas))}
worker.checked_job_input(payload,sorted(shas))
def deny(value,allowed=sorted(shas)):
 try:worker.checked_job_input(value,allowed)
 except ValueError:pass
 else:raise AssertionError("unauthorized_source_or_mutated_contract")
deny({**payload,"dataPolicy":"patient"})
deny({**payload,"model":"mock"})
deny({**payload,"originalDicomSha256":["b"*64]*8})
deny({**payload,"originalDicomSha256":["nonhex"]*8})
deny({**payload,"originalDicomSha256":shas[:-1]})
deny({**payload,"originalDicomSha256":shas+["f"*64]})
deny(payload,sorted(shas[:-1]+["f"*64]))
# No implicit weight downloads; never repair/rewrite an incomplete model cache.
from tempfile import TemporaryDirectory
with TemporaryDirectory() as root:
 from pathlib import Path
 p=Path(root)/"ianpan"
 try:
  worker.provision_original_ich_weights(p,public_model_rights_reviewed=False)
 except ValueError as error:
  assert "license_review_required" in str(error)
 else:raise AssertionError("publisher_weights_download_without_license_approval")
 assert not p.exists()
 p.mkdir()
 try:
  worker.provision_original_ich_weights(p,public_model_rights_reviewed=True)
 except ValueError as error:
  assert "existing_model_cache_unverified" in str(error)
 else:raise AssertionError("incomplete_model_directory_wrongly_accepted")
print("PASS public ICH immutable source + opt-in official model cache; no model downloaded")
