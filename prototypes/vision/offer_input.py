"""Bounded local inputs and an OCR-only Windows adapter for native images."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

from PIL import Image

from recognize import MAX_PIXELS, ROOT, read_image

MAX_BYTES = 12 * 1024 * 1024


def read_json(path: Path) -> dict:
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Input exceeds 12 MiB.")
    result = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(result, dict):
        raise ValueError("Expected a JSON object.")
    return result


def validate_ocr(ocr: dict, size: tuple[int, int]) -> dict:
    if not isinstance(ocr, dict) or ocr.get("status") not in {"ok", "unavailable", "error"}:
        raise ValueError("Unsupported OCR status.")
    lines = ocr.get("lines", [])
    if not isinstance(lines, list) or len(lines) > 500:
        raise ValueError("Too many OCR lines.")
    for line in lines:
        if not isinstance(line, dict) or not isinstance(line.get("text"), str) or len(line["text"]) > 2000:
            raise ValueError("Invalid OCR line.")
        for key in ["x", "y", "width", "height"]:
            value = line.get(key)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < 0:
                raise ValueError("Invalid OCR geometry.")
        if line["x"] + line["width"] > size[0] + 1 or line["y"] + line["height"] > size[1] + 1:
            raise ValueError("OCR lies outside the image.")
    return {**ocr, "lines": lines}


def read_capture(path: Path) -> tuple[Image.Image, dict, str]:
    capture = read_json(path)
    if capture.get("kind") != "fate-collector.capture" or capture.get("schemaVersion") != 1:
        raise ValueError("Expected a version 1 helper capture.")
    meta = capture.get("image", {})
    if meta.get("mimeType") != "image/png":
        raise ValueError("Capture must contain PNG pixels.")
    data = base64.b64decode(meta.get("dataBase64", ""), validate=True)
    with Image.open(io.BytesIO(data)) as source:
        if source.format != "PNG" or source.width * source.height > MAX_PIXELS or max(source.size) > 8192:
            raise ValueError("Unsupported capture dimensions or format.")
        if source.size != (meta.get("width"), meta.get("height")):
            raise ValueError("Capture dimensions do not match pixels.")
        image = source.convert("RGB")
    return image, validate_ocr(capture.get("ocr"), image.size), hashlib.sha256(data).hexdigest()


def windows_ocr(path: Path, *, enlarge_small: bool = True) -> dict:
    if os.name != "nt":
        raise ValueError("Windows OCR is unavailable here. Supply a helper capture or --ocr fixture.")
    # OCR-only output avoids the capture helper's 9 MiB PNG bundle limit. Native
    # 4K screenshots can exceed that limit; never resize merely to fit a bundle.
    scratch = (ROOT / "output/ocr-work").resolve()
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="capture-", dir=scratch) as directory:
        if not Path(directory).resolve().is_relative_to(scratch):
            raise ValueError("Temporary capture directory escaped the prototype output directory.")
        image = read_image(path)
        factor = 2 if enlarge_small and image.height < 1080 and max(image.size) * 2 <= 4096 else 1
        input_path = path.resolve()
        if factor != 1:
            input_path = Path(directory) / "ocr-input.png"
            image.resize((image.width * factor, image.height * factor), Image.Resampling.LANCZOS).save(input_path)
        process = subprocess.run([
            "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned",
            "-File", str(ROOT / "Read-ImageOcr.ps1"),
            "-InputImage", str(input_path), "-OutputJson", str(Path(directory) / "ocr.json"),
        ], capture_output=True, text=True, timeout=60)
        if process.returncode not in {0, 10, 11}:
            raise ValueError(f"Windows OCR helper failed: {process.stderr.strip()[:500]}")
        record = read_json(Path(directory) / "ocr.json")
        ocr = record["ocr"]
        if factor != 1:
            ocr = {**ocr, "lines": [{**line, **{key: line[key] / factor for key in ["x", "y", "width", "height"]}}
                                    for line in ocr["lines"]]}
        return {**record, "ocr": validate_ocr(ocr, image.size), "ocrResizeFactor": factor}


def load_input(path: Path, ocr_path: Path | None = None) -> tuple[Image.Image, dict, str]:
    if path.suffix.lower() == ".json":
        if ocr_path:
            raise ValueError("A helper capture already contains its OCR.")
        return read_capture(path)
    image = read_image(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if ocr_path:
        fixture = read_json(ocr_path)
        if fixture.get("kind") != "fate-collector.ocr-fixture" or fixture.get("sourceSha256") != digest or fixture.get("size") != list(image.size):
            raise ValueError("OCR fixture does not belong to this exact image.")
        ocr = fixture.get("ocr")
    else:
        ocr = windows_ocr(path)["ocr"]
    return image, validate_ocr(ocr, image.size), digest
