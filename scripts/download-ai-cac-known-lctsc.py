#!/usr/bin/env python3
"""Obtain known immutable TCIA LCTSC series directly from official NBIA image API.

The TCIA getSeries *metadata search* sometimes times out, blocking otherwise
available source images. Instead require immutable original 103-file SHA chain
already independently verified in Opus and official LCTSC CC BY 3.0 reference.
Fail closed on changed pixels, geometry, archive members or incomplete source.
"""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import urllib.request

SRC=Path(__file__).with_name("download-r231-browser-reference.py")
spec=importlib.util.spec_from_file_location("official_lctsc_pinned_preparation",SRC)
source=importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)

def run(destination:Path):
    if destination.exists() or destination.is_symlink():
        raise ValueError("new_outside_repository_public_source_directory_required")
    if destination.resolve().is_relative_to(source.ROOT):
        raise ValueError("public_original_CT_must_remain_outside_GitHub_repo")
    # Current official v4 endpoint; v1 remains fallback during TCIA migration.
    # Either response MUST pass the same independently pinned 103-DICOM SHA chain.
    endpoints=[
        "https://nbia.cancerimagingarchive.net/nbia-api/services/v4/getImage?SeriesInstanceUID="+source.SERIES,
        source.BASE+"getImage?SeriesInstanceUID="+source.SERIES,
    ]
    allowed_hosts={"nbia.cancerimagingarchive.net","services.cancerimagingarchive.net"}
    with tempfile.TemporaryDirectory(prefix="opus-lctsc-official-research-") as tmp:
        archive=Path(tmp)/"original.zip"
        last=None
        for url in endpoints:
            for attempt in range(1,3):
                try:
                    request=urllib.request.Request(url,headers={
                        "User-Agent":"OpusAI-LCTSC-public-reproducibility/1"})
                    with urllib.request.urlopen(request,timeout=150) as res,archive.open("wb") as sink:
                        from urllib.parse import urlsplit
                        destination_url=urlsplit(res.url)
                        if (res.status!=200 or destination_url.scheme!="https" or
                            destination_url.hostname not in allowed_hosts):
                            raise ValueError("not_allowed_official_TCIA_public_getImage_response")
                        total=0
                        while buf:=res.read(1024*1024):
                            total+=len(buf)
                            if total>30*1024**2:
                                raise ValueError("unbounded_LCTSC_publisher_archive")
                            sink.write(buf)
                    result=source.prepare(archive,destination,full_series=True)
                    if (result["sourceContentChainSha256"]!=source.CONTENT_CHAIN
                        or result["selectedFrames"]!=103
                        or result["allSourceFrames"] is not True):
                        raise ValueError("not_original_immutable_full_103_slice_series")
                    print(json.dumps({
                        "publisher":"TCIA LCTSC","license":"CC BY 3.0",
                        "originalCTVerified":True,
                        "originalSliceCount":result["selectedFrames"],
                        "originalPinnedSourceSHA256Chain":result["sourceContentChainSha256"],
                        "sourcePixelDataInGitHubArtifacts":False,
                        "liveSeriesMetadataSearchRequired":False,
                        "modelInferencePerformed":False
                    }))
                    return
                except (OSError,ValueError) as e:
                    last=type(e).__name__
                    archive.unlink(missing_ok=True)
                    if destination.exists():
                        # Never reuse a partial result, even when another endpoint exists.
                        raise
                    if attempt<2:time.sleep(5)
        raise RuntimeError("known_original_public_TCIA_getImage_unavailable:"+str(last))

if __name__=="__main__":
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path,required=True)
    run(p.parse_args().output)
