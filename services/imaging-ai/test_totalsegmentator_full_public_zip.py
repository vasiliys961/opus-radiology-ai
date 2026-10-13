"""Offline tests for public DICOM ZIP conversion to native full-grid NIfTI."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path

import numpy as np
import pydicom
import pytest
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("package_lctsc", ROOT/"scripts/package-totalseg-lctsc-reference.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def sample(tmp_path, monkeypatch):
    monkeypatch.setattr(mod.ref,"TOTAL",2)
    path=tmp_path/"reference"
    (path/"dicom").mkdir(parents=True)
    hashes=[]
    blocks=[]
    for i in range(2):
        meta=FileMetaDataset()
        meta.TransferSyntaxUID=ExplicitVRLittleEndian
        meta.MediaStorageSOPClassUID="1.2.840.10008.5.1.4.1.1.2"
        meta.MediaStorageSOPInstanceUID=f"2.25.{i+1}"
        d=FileDataset(None,{},file_meta=meta,preamble=b"\x00"*128)
        d.Modality="CT";d.SeriesInstanceUID=mod.ref.SERIES
        d.SOPClassUID=meta.MediaStorageSOPClassUID
        d.SOPInstanceUID=meta.MediaStorageSOPInstanceUID
        d.Rows=512;d.Columns=512;d.RescaleSlope=1;d.RescaleIntercept=-1000
        d.SamplesPerPixel=1;d.PhotometricInterpretation="MONOCHROME2"
        d.BitsAllocated=16;d.BitsStored=16;d.HighBit=15;d.PixelRepresentation=0
        pixels=np.full((512,512),1000+i,dtype="<u2")
        pixels[0,1]+=1
        d.PixelData=pixels.tobytes()
        buffer=io.BytesIO();pydicom.dcmwrite(buffer,d)
        raw=buffer.getvalue()
        (path/"dicom"/f"reference-{i:03}.dcm").write_bytes(raw)
        hashes.append(hashlib.sha256(raw).hexdigest())
        blocks.append((pixels.astype("<f4")-1000).astype("<f4").tobytes())
    affine=[1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,3.,0.]
    expected=hashlib.sha256(mod.ref.nifti_header(affine,2)+b"".join(blocks)).hexdigest()
    manifest={"schema":"opus-r231-browser-reference/v1","collection":"TCIA LCTSC",
              "license":"CC BY 3.0","sourceContentChainSha256":mod.ref.CONTENT_CHAIN,
              "allSourceFrames":True,"selectedFrames":2,
              "dimensions":[512,512,2],"selectedIndicesZeroBased":[0,1],
              "selectedFileSha256":hashes,
              "niftiCandidates":[{"affineLps":affine,"inputSha256":expected},
                                 {"affineLps":affine,"inputSha256":"b"*64}]}
    (path/"reference.json").write_text(json.dumps(manifest))
    return path,expected

def test_pinned_series_written_as_exact_source_bound_native_nifti(tmp_path,monkeypatch):
    folder,expected=sample(tmp_path,monkeypatch)
    target=tmp_path/"public.nii"
    report=mod.assemble_public_ct(folder,target)
    assert report["inputSha256"]==expected
    assert hashlib.sha256(target.read_bytes()).hexdigest()==expected
    assert report["clinicalStatus"]=="not_validated"

def test_changed_public_dicom_is_rejected_without_partial_output(tmp_path,monkeypatch):
    folder,_=sample(tmp_path,monkeypatch)
    p=folder/"dicom/reference-000.dcm";p.write_bytes(p.read_bytes()+b"tampered")
    target=tmp_path/"public.nii"
    with pytest.raises(ValueError,match="dicom_content_mismatch"):
        mod.assemble_public_ct(folder,target)
    assert not target.exists()

def test_partial_reference_fails_closed(tmp_path,monkeypatch):
    folder,_=sample(tmp_path,monkeypatch)
    path=folder/"reference.json";manifest=json.loads(path.read_text())
    manifest["allSourceFrames"]=False
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError,match="not_pinned_complete_public_reference"):
        mod.assemble_public_ct(folder,tmp_path/"public.nii")

def test_manual_workflow_does_not_upload_ct_or_weights():
    source=(ROOT/".github/workflows/totalseg-full-lctsc-public-ct.yml").read_text()
    assert "workflow_dispatch:" in source
    assert "--full-series" in source
    assert "run-totalseg-first-inference.py" in source
    assert "timeout --signal=TERM" in source
    assert "upload-artifact" not in source
    assert "schedule:" not in source
