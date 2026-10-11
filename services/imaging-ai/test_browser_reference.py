"""Reference preparation safety: synthetic headers only, no download/model."""
import importlib.util
from pathlib import Path
import struct
import zipfile
import io

import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian
import pytest

spec = importlib.util.spec_from_file_location("reference", Path(__file__).resolve().parents[2] / "scripts/download-r231-browser-reference.py")
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)


def test_nifti_exact_signed_zero_header_and_reverse_z():
    affine = [0.976562, 0, 0, -250, 0, 0.976562, 0, -156, 0, 0, -3, 238]
    h = reference.nifti_header(affine)
    assert struct.unpack_from("<4h", h, 40) == (3, 512, 512, 32)
    assert struct.unpack_from("<hh", h, 70) == (16, 32)
    assert struct.unpack_from("<I", h, 284)[0] == 0x80000000  # JS -0 in RAS sform
    assert struct.unpack_from("<f", h, 320)[0] == -3
    assert struct.unpack_from("<f", h, 324)[0] == 238


def test_existing_or_repository_output_is_never_overwritten(tmp_path):
    destination = tmp_path / "existing"
    destination.mkdir()
    sentinel = destination / "keep.txt"
    sentinel.write_text("preserve")
    for path in (destination, reference.ROOT / "never-create-reference-data"):
        with pytest.raises(ValueError, match="new directory outside"):
            reference.prepare(tmp_path / "nonexistent.zip", path)
    assert sentinel.read_text() == "preserve"


def test_zip_path_entries_are_not_extracted(tmp_path):
    archive = tmp_path / "unexpected.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for i in range(103): z.writestr(f"placeholder-{i}.dcm", b"")
        z.writestr("../escaped.txt", b"never-extract")
    with pytest.raises(Exception): reference.prepare(archive, tmp_path / "output")
    assert not (tmp_path / "escaped.txt").exists()
    assert not (tmp_path / "output").exists()


def test_unpinned_dicom_pixels_or_headers_are_rejected_before_files_written(tmp_path):
    archive = tmp_path / "synthetic.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("LICENSE", "synthetic fixture")
        for i in range(103):
            meta = FileMetaDataset()
            meta.TransferSyntaxUID = ExplicitVRLittleEndian
            d = FileDataset(None, {}, file_meta=meta, preamble=b"\0"*128)
            d.Modality = "CT"
            d.SeriesInstanceUID = reference.SERIES
            d.SOPInstanceUID = f"2.25.{i+1}"
            d.Rows, d.Columns = 512, 512
            d.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
            d.ImagePositionPatient = [0, 0, 3*i]
            d.RescaleSlope, d.RescaleIntercept = 1, -1000
            buffer = io.BytesIO()
            pydicom.dcmwrite(buffer, d)
            z.writestr(f"synthetic-{i:03}.dcm", buffer.getvalue())
    with pytest.raises(ValueError, match="content changed"):
        reference.prepare(archive, tmp_path / "output")
    assert not (tmp_path / "output").exists()
