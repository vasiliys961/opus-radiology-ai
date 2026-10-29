#!/usr/bin/env python3
"""One operator bootstrap: provision XRV original weights, share a PRIVATE
localhost token with Next development, launch verified CPU worker.

Never use on a public HTTP server or for patient radiographs. Not required
for clinician: this is deployment configuration, not an analysis-time step.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import re
import secrets
import sys

from provision_xrv_original_model import provision

KEY="OPUS_XRV_WORKER_TOKEN"

def configure_token(file_path,existing=None):
    target=Path(file_path)
    if target.is_symlink():
        raise ValueError("refuse_symlinked_Next_environment")
    if not target.parent.is_dir():
        raise ValueError("Next_web_directory_unavailable")
    token=existing
    lines=target.read_text().splitlines() if target.exists() else []
    match=[line.split("=",1)[1] for line in lines if line.startswith(KEY+"=")]
    if len(match)>1:
        raise ValueError("duplicate_XRV_server_secret")
    if match:
        if token and token!=match[0]:
            raise ValueError("running_secret_does_not_match_Next_server_secret")
        token=match[0]
    if not token:
        token=secrets.token_urlsafe(48).replace("-","_")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}",token):
        raise ValueError("bad_private_session_secret")
    if not match:
        fd=os.open(target,os.O_WRONLY|os.O_APPEND|os.O_CREAT,0o600)
        try:
            with os.fdopen(fd,"a") as out:
                out.write("\n"+KEY+"="+token+"\n")
                out.flush()
                os.fsync(out.fileno())
        except:
            raise
    target.chmod(0o600)
    return token


def main():
    p=argparse.ArgumentParser(description=__doc__)
    repo=Path(__file__).resolve().parents[1]
    p.add_argument("--cache",default="~/.cache/opus-radiology/original-models/xrv")
    p.add_argument("--yandex-manifest",type=Path)
    p.add_argument("--next-env",type=Path,default=repo/"web/.env.local")
    p.add_argument("--port",type=int,default=8779)
    p.add_argument("--origin",default="http://127.0.0.1:3000")
    a=p.parse_args()
    if sys.platform!="linux":
        p.error("Heavy original TorchXRayVision worker requires an isolated Linux host")
    # Model acquisition/verification before starting worker; never fake readiness.
    result=provision(a.cache,yandex_manifest=a.yandex_manifest,
                     token=os.environ.get("YANDEX_DISK_TOKEN",""))
    token=configure_token(a.next_env,os.environ.get(KEY))
    print("Original XRV weights verified:",result["sha256"],flush=True)
    print("Next server secret exists in a private env file; reload Next on first setup.",flush=True)
    env=os.environ.copy()
    env[KEY]=token
    worker=repo/"services/imaging-ai/cxr_xrv_direct_worker.py"
    os.execve(sys.executable,[sys.executable,str(worker),
                              "--weights",result["file"],
                              "--port",str(a.port),"--origin",a.origin],env)


if __name__=="__main__":
    main()
