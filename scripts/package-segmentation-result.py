"""Package an existing inference output, without running/loading/downloading a model."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import uuid


def checksum(path, limit=None):
    if limit and path.stat().st_size > limit:
        raise ValueError("File exceeds package size limit")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path):
    if path.stat().st_size > 65536:
        raise ValueError("JSON file exceeds 64 KiB")
    return json.loads(path.read_text(encoding="utf-8"))


def checked_text(value, limit=160):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError("Invalid model/label/limitation text")
    return value.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--mask", type=Path, required=True)
    parser.add_argument("--weights-artifact", type=Path, required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--labels", type=Path, required=True, help='JSON array of {"id":1,"name":"..."}')
    parser.add_argument("--limitation", action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    request = read_json(args.request)
    if request.get("schema") != "opus-analysis-request/v1":
        raise ValueError("Unsupported request schema")
    request_id = request.get("requestId")
    parsed_id = uuid.UUID(request_id)
    if parsed_id.version != 4 or str(parsed_id) != request_id:
        raise ValueError("Invalid request ID")
    for key in ("sourceIdentitySha256", "inputSha256"):
        if not isinstance(request.get(key), str) or not re.fullmatch("[a-f0-9]{64}", request[key]):
            raise ValueError("Invalid source/input digest")
    if checksum(args.input, 352 + 4 * 8388608) != request["inputSha256"]:
        raise ValueError("Input bytes do not match the selected request")
    labels = read_json(args.labels)
    if not isinstance(labels, list) or len(labels) > 256:
        raise ValueError("Invalid label dictionary")
    ids = set()
    clean_labels = []
    for label in labels:
        label_id = label.get("id")
        if type(label_id) is not int or not 1 <= label_id <= 65535 or label_id in ids:
            raise ValueError("Invalid or duplicate label ID")
        ids.add(label_id)
        clean_labels.append({"id": label_id, "name": checked_text(label.get("name"))})
    if len(args.limitation) > 20:
        raise ValueError("Too many limitations")
    result = {
        "schema": "opus-segmentation-result/v1",
        "requestId": request_id,
        "sourceIdentitySha256": request["sourceIdentitySha256"],
        "inputSha256": request["inputSha256"],
        "maskSha256": checksum(args.mask, 32 * 1024 * 1024),
        "model": {
            "id": checked_text(args.model_id),
            "version": checked_text(args.model_version),
            "weightsSha256": checksum(args.weights_artifact),
            "modality": checked_text(request.get("modality"), 16),
            "task": checked_text(args.task),
        },
        "labels": clean_labels,
        "limitations": [checked_text(s, 500) for s in args.limitation],
    }
    encoded = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(encoded) > 65536:
        raise ValueError("Result JSON exceeds 64 KiB")
    # Refuse to overwrite an existing result or follow a pre-existing symlink.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(encoded)
    print("Packaged existing mask; no inference was performed.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, AttributeError, OSError) as error:
        print(f"Result packaging failed: {error}", file=sys.stderr)
        sys.exit(1)
