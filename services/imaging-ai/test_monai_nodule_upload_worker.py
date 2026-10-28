"""HTTP checks for real source upload contract (fake runner, NEVER model accuracy)."""
import hashlib,json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient

sys.path.insert(0,str(Path(__file__).resolve().parent))
import monai_nodule_upload_worker as worker

class UploadHTTP(unittest.TestCase):
    def test_upload_hash_auth_content_and_cleanup(self):
        with tempfile.TemporaryDirectory() as scratch:
            root=Path(scratch)
            bundle=root/"bundle"
            (bundle/"models").mkdir(parents=True)
            (bundle/"configs").mkdir()
            (bundle/"scripts").mkdir()
            (bundle/"models/model.pt").write_bytes(b"test-model-stub")
            (bundle/"scripts/detection_inferer.py").write_text("# test stub")
            (bundle/"configs/metadata.json").write_text(json.dumps({
                "version":"0.6.9",
                "intended_use":"This is an example, not to be used for diagnostic purposes"}))
            (bundle/"configs/inference.json").write_text(json.dumps({
                "num_classes":1,"infer_patch_size":[512,512,192],
                "postprocessing":{"transforms":[{},{"_target_":"AffineBoxToWorldCoordinated","affine_lps_to_ras":True}]},
                "preprocessing":{"transforms":[{},{"affine_lps_to_ras":True}]}}))
            def digest(path):
                path=Path(path)
                if path.name=="model.pt":return "a"*64
                return hashlib.sha256(path.read_bytes()).hexdigest()
            fake=SimpleNamespace(MODEL_SHA="a"*64,MODEL_REPO_REV="test",
                digest=digest,
                original_nifti=lambda p:{"sourceSha256":digest(p)},
                source_admission=lambda p,m:None)
            with patch.object(worker,"original_runner",return_value=fake),patch.object(
                worker.psutil,"virtual_memory",return_value=SimpleNamespace(available=20*1024**3)):
                app=worker.create_upload_app(bundle=bundle,token="z"*40,
                    origin="http://localhost:3000",scratch=root)
                headers={"host":"127.0.0.1:8768","origin":"http://localhost:3000",
                    "authorization":"Bearer "+"z"*40,"content-type":"application/octet-stream"}
                payload=b"research-only-stub-not-DICOM-or-NIfTI"*20
                sha=hashlib.sha256(payload).hexdigest()
                with TestClient(app,base_url="http://127.0.0.1:8768") as client:
                    self.assertEqual(client.post("/v1/nodule/upload",
                        headers={**headers,"authorization":"Bearer wrong",
                        "x-opus-source-sha256":sha},content=payload).status_code,401)
                    self.assertEqual(client.post("/v1/nodule/upload",
                        headers={**headers,"x-opus-source-sha256":"0"*64},
                        content=payload).status_code,422)
                    good=client.post("/v1/nodule/upload",
                        headers={**headers,"x-opus-source-sha256":sha},content=payload)
                    self.assertEqual(good.status_code,201,good.text)
                    job=good.json()["jobId"]
                    self.assertEqual(client.post("/v1/nodule/upload",
                        headers={**headers,"x-opus-source-sha256":sha},content=payload).status_code,409)
                    self.assertEqual(client.delete(f"/v1/nodule/jobs/{job}",headers=headers).status_code,200)

if __name__=="__main__":unittest.main()
