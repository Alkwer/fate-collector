"""Additional evidence for ambiguous OCR headers and partly covered icon borders."""
from __future__ import annotations

import re
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

from offer_input import windows_ocr
from recognize import ROOT, classify, crop, similarity


def text_key(text):
    # Common glyph confusions, used only for comparing independent OCR readings.
    return re.sub('[^a-z]', '', text.lower().translate(str.maketrans({'0': 'o', '!': 'l', '|': 'l'})))


def edit_distance(a, b):
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j-1] + (left != right)))
        previous = current
    return previous[-1]


def name_consensus(raw, readings, names):
    """Require two agreeing header passes, a unique nearby name and compatible OCR.

    This is dictionary-assisted OCR, not a claim of human verification. No aliases
    for the two observed errors are embedded in the algorithm.
    """
    if raw and text_key(raw) not in {text_key(name) for name in names} and all(text_key(text) == text_key(raw) for text in readings):
        # Re-reading the same unknown word is no extra evidence for replacing it
        # with a catalog name (e.g. a genuinely unseen one-letter neighbour).
        return None
    votes, distances = [], []
    for text in readings:
        key = text_key(text)
        ranked = sorted((edit_distance(key, text_key(name)), name) for name in names)
        if len(ranked) < 2 or len(key) < 4:
            return None
        distance, name = ranked[0]
        if distance > max(1, len(text_key(name)) // 4) or ranked[1][0] - distance < 2:
            return None
        votes.append(name)
        distances.append(distance)
    if len(votes) < 2 or len(set(votes)) != 1:
        return None
    name = votes[0]
    if raw and edit_distance(text_key(raw), text_key(name)) > max(2, len(text_key(name)) // 4):
        return None
    return {"name": name, "editDistances": distances, "method": "dictionary-assisted-header-consensus"}


def read_header(image: Image.Image, box: list[float]) -> list[str]:
    x, y, w, h = box
    if x < 0 or y < 0 or x + w > image.width or y + h > image.height:
        return []
    header = image.crop((round(x), round(y), round(x + w), round(y + h)))
    header = ImageOps.autocontrast(ImageOps.grayscale(header), cutoff=2)
    # Two predetermined OCR scales; normalize to the same text height regardless
    # of screenshot resolution. Do not add pixels to the input used by vision.
    readings = []
    scratch = ROOT / "output/ocr-work"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="header-", dir=scratch) as directory:
        if not Path(directory).resolve().is_relative_to(scratch.resolve()):
            raise ValueError("Header directory escaped the output directory.")
        for height in [46, 69]:
            size = (max(1, round(header.width * height / header.height)), height)
            prepared = ImageOps.expand(header.resize(size, Image.Resampling.LANCZOS), border=15, fill=200).convert("RGB")
            prepared = prepared.resize((prepared.width * 2, prepared.height * 2), Image.Resampling.LANCZOS)
            path = Path(directory) / f"header-{height}.png"
            prepared.save(path)
            record = windows_ocr(path, enlarge_small=False)
            lines = record["ocr"]["lines"] if record["ocr"]["status"] == "ok" else []
            readings.append(lines[0]["text"] if len(lines) == 1 else "")
    return readings


def refine_icon(image: Image.Image, detection: dict, bank: list[dict]) -> dict:
    # Keep colour/occlusion failures unknown. Full glyph evidence must already be
    # close; the interior alone cannot turn a weak background peak into a label.
    if detection["status"] != "unknown" or detection["family"] != "reward" or detection.get("reason") != "low-similarity-or-ambiguous" or detection["score"] < .80:
        return detection
    patch = crop(image, detection["box"])
    ranked = sorted(((similarity(patch, t["pixels"]), t["visualId"]) for t in bank if t["family"] == "reward"), reverse=True)
    full_winner = ranked[0][1]
    results = []
    for border in [3, 4]:
        def interior(pixels):
            # Reduce to scanner bandwidth before cropping to avoid comparing a
            # sharp native 4K glyph with a 1080p template at unequal resolution.
            size = (min(24, pixels.width), min(24, pixels.height))
            pixels = pixels.resize(size, Image.Resampling.LANCZOS)
            bx, by = round(border * size[0] / 24), round(border * size[1] / 24)
            return pixels.crop((bx, by, size[0] - bx, size[1] - by))
        inner_bank = [{**t, "pixels": interior(t["pixels"])} for t in bank if t["family"] == "reward"]
        prediction = classify(interior(patch), "reward", inner_bank)
        if prediction["status"] != "candidate" or prediction["visualId"] != full_winner or prediction["score"] < .90 or prediction["margin"] < .10:
            return detection
        results.append(prediction)
    return {**detection, **results[0], "method": "whole-patch-plus-two-interiors",
            "wholePatchScore": detection["score"], "interiorScores": [r["score"] for r in results]}
