#!/usr/bin/env python3
"""Real FastAPI HTTP lifecycle checks with synthetic data, zero model calls."""
import hashlib
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from fastapi.testclient import TestClient

path=Path(__file__).resolve().parents[1]/"services/imaging-ai/monai_nodule_public_worker.py"
spec=importlib.util.spec_from_file_location("opus_live_monai_http",path)
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

class SyntheticOriginal:
    MODEL_REPO_REV="7226a40a4c3713f7d5469559b7f2fc296fd54825"
    AUTH="PUBLIC-CHEST-CT-NODULE-RESEARCH-OK"
    def __init__(self,checkpoint):
        self.MODEL_SHA=checkpoint
    def original_nifti(self,path):
        return {"sourceSha256":digest(path)}
    def source_admission(self,path,source):
        if not path.exists():raise ValueError("unknown_source")
        return {"researchOnly":True}
    digest=staticmethod(digest)

for origin in ("http://localhost:3000","https://doctor-opus.example.org"):
    worker.check_origin(origin)
for bad in ("http://example.org","https://*.example.org",
            "https://doctor-opus.example.org/path","http://localhost",
            "https://user:pass@example.org"):
    try:worker.check_origin(bad)
    except ValueError:pass
    else:raise AssertionError("unsafe_origin_permitted")

with TemporaryDirectory() as temp:
    root=Path(temp)
    source=root/"positive-public-research.nii"
    source.write_bytes(b"synthetic-test-file-not-patient" * 20)
    sha=digest(source)
    manifest=root/"public-admission.json"
    manifest.write_text('{"synthetic":true}',encoding="utf-8")
    bundle=root/"official-bundle"
    (bundle/"models").mkdir(parents=True)
    (bundle/"configs").mkdir()
    (bundle/"scripts").mkdir()
    ckpt=bundle/"models/model.pt"
    ckpt.write_bytes(b"TEST ONLY - NOT A TRAINED MONAI CHECKPOINT")
    model=SyntheticOriginal(digest(ckpt))
    worker.original_runner=lambda:model
    (bundle/"configs/metadata.json").write_text(json.dumps({
       "version":"0.6.9",
       "intended_use":"This is an example, not to be used for diagnostic purposes"
    }))
    (bundle/"configs/inference.json").write_text(json.dumps({
       "num_classes":1,"infer_patch_size":[512,512,192],
       "postprocessing":{"transforms":[{},{
           "_target_":"AffineBoxToWorldCoordinated","affine_lps_to_ras":True}]},
       "preprocessing":{"transforms":[{},{"affine_lps_to_ras":True}]}
    }))
    (bundle/"scripts/detection_inferer.py").write_text("# fake fixture")
    origin="https://doctor-opus.example.org"
    token="A"*48
    app=worker.create_app(source=source,admission=manifest,bundle=bundle,
       token=token,origin=origin,port=8767,scratch=root)
    auth={"Origin":origin,"Authorization":"Bearer "+token}
    with TestClient(app,base_url="http://127.0.0.1:8767") as client:
        denied=client.get("/v1/nodule/capabilities",headers={
            "Origin":"https://other.example.org","Authorization":"Bearer "+token})
        assert denied.status_code==403
        assert "Access-Control-Allow-Origin" not in denied.headers
        assert client.get("/v1/nodule/capabilities",headers={"Origin":origin}).status_code==401
        options=client.options("/v1/nodule/jobs",headers={
          "Origin":origin,"Access-Control-Request-Method":"POST",
          "Access-Control-Request-Headers":"authorization,content-type",
          "Access-Control-Request-Private-Network":"true"})
        assert options.status_code==204
        assert options.headers["Access-Control-Allow-Private-Network"]=="true"
        cap=client.get("/v1/nodule/capabilities",headers=auth)
        assert cap.status_code==200 and cap.json()["patientMode"] is False
        assert cap.json()["imageUpload"] is False
        payload={"schema":"opus-monai-nodule-request/v1",
                 "sourceSha256":sha,"dataPolicy":"approved-public-reference-only"}
        for bad in [
           {**payload,"sourceSha256":"0"*64},
           {**payload,"dataPolicy":"patient"},
           {**payload,"imagePixels":"forbidden"},
        ]:
            assert client.post("/v1/nodule/jobs",headers=auth,json=bad).status_code==422
        real_psutil=worker.psutil.virtual_memory
        real_spawn=worker.asyncio.create_subprocess_exec
        worker.psutil.virtual_memory=lambda:SimpleNamespace(available=20*1024**3)
        class FakeProcess:
            returncode=0
            pid=-1
            async def wait(self):return 0
        async def synthetic_spawn(*args,**kwargs):
            out=Path(args[args.index("--output")+1])
            out.write_text(json.dumps({
                "schema":"opus-monai-bound-nodule-inference/v1",
                "source":{"sha256":sha},
                "model":{"weightsSha256":model.MODEL_SHA},
                "execution":{"actualPretrainedInferenceCompleted":True},
                "clinicalStatus":"unverified_research_draft",
                "clinicallyValidated":False,"negativeDiagnosisAllowed":False,
                "candidates":[],"fixtureOnly":True,
            }))
            return FakeProcess()
        worker.asyncio.create_subprocess_exec=synthetic_spawn
        try:
            submit=client.post("/v1/nodule/jobs",headers=auth,json=payload)
            assert submit.status_code==201,submit.text
            jid=submit.json()["jobId"]
            for _ in range(50):
                import time
                job=client.get("/v1/nodule/jobs/"+jid,headers=auth)
                if job.json()["state"]=="succeeded":break
                time.sleep(.025)
            else:raise AssertionError("mock_async_job_not_done")
            result=client.get("/v1/nodule/jobs/"+jid+"/report",headers=auth)
            assert result.status_code==200
            assert result.json()["fixtureOnly"] is True
            assert client.post("/v1/nodule/jobs",headers=auth,json=payload).status_code==409
            deleted=client.delete("/v1/nodule/jobs/"+jid,headers=auth)
            assert deleted.status_code==200
            assert client.get("/v1/nodule/jobs/"+jid,headers=auth).status_code==404
        finally:
            worker.psutil.virtual_memory=real_psutil
            worker.asyncio.create_subprocess_exec=real_spawn
print("PASS genuine HTTP job lifecycle + bearer + source SHA; synthetic fixture only")
