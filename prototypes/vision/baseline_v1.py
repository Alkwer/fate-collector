"""Local, abstaining visual matcher. No network, OCR, capture or upload side effects."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
VERSION = "fate-visual-prototype-1"
MAX_PIXELS = 16_777_216
# Similarities, NOT probabilities. Frozen before evaluating the held-out showcase.
MIN_SCORE = 0.86
MIN_MARGIN = 0.07
PROPOSAL_SCORE = 0.72


def read_image(path: Path) -> Image.Image:
    with Image.open(path) as source:
        if source.width * source.height > MAX_PIXELS or max(source.size) > 8192:
            raise ValueError("Image exceeds 8192 px or 16,777,216 pixels; crop first.")
        return source.convert("RGB")


def gray(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("L"), dtype=np.float64) / 255


def correlation(image: np.ndarray, template: np.ndarray) -> np.ndarray:
    """Valid normalized cross-correlation using FFT and summed-area tables."""
    h, w = template.shape
    ih, iw = image.shape
    if h > ih or w > iw:
        return np.empty((0, 0))
    centered = template - template.mean()
    norm = np.linalg.norm(centered)
    if norm < 1e-8:
        return np.zeros((ih - h + 1, iw - w + 1))
    # Circular correlation contains the entire VALID region without padding.
    numerator = np.fft.irfft2(
        np.fft.rfft2(image) * np.conj(np.fft.rfft2(centered, s=image.shape)),
        s=image.shape,
    )[:ih - h + 1, :iw - w + 1]

    def sums(values: np.ndarray) -> np.ndarray:
        table = np.pad(values.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
        return table[h:, w:] - table[:-h, w:] - table[h:, :-w] + table[:-h, :-w]

    variance = np.maximum(0, sums(image * image) - sums(image) ** 2 / (h * w))
    denominator = norm * np.sqrt(variance)
    return np.clip(np.divide(numerator, denominator, out=np.zeros_like(numerator),
                             where=denominator > 1e-8), -1, 1)


def crop(image: Image.Image, box: list[int]) -> Image.Image:
    x, y, w, h = box
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > image.width or y + h > image.height:
        raise ValueError(f"Invalid crop: {box} in {image.size}")
    return image.crop((x, y, x + w, y + h))


def load_bank() -> list[dict]:
    catalog = json.loads((ROOT / "fixtures/catalog-v1.json").read_text(encoding="utf-8"))
    bank = []
    for entry in catalog["templates"]:
        image = read_image(ROOT / "fixtures" / entry["image"])
        bank.append({**entry, "pixels": crop(image, entry["box"])})
    return bank


def similarity(a: Image.Image, b: Image.Image) -> float:
    """Compare shape and colour; the frame alone must not identify an icon."""
    a = np.asarray(a.resize((24, 24), Image.Resampling.BILINEAR), dtype=float) / 255
    b = np.asarray(b.resize((24, 24), Image.Resampling.BILINEAR), dtype=float) / 255
    ac, bc = a - a.mean(), b - b.mean()
    denom = np.linalg.norm(ac) * np.linalg.norm(bc)
    if denom < 1e-8:
        return 0.0
    shape = float(np.sum(ac * bc) / denom)
    colour = max(0.0, 1 - float(np.sqrt(np.mean((a - b) ** 2))) * 2)
    return 0.8 * shape + 0.2 * colour


def classify(patch: Image.Image, family: str, bank: list[dict]) -> dict:
    ranked: dict[str, tuple[float, dict]] = {}
    for template in bank:
        if template["family"] != family:
            continue
        score = similarity(patch, template["pixels"])
        key = template["visualId"]
        if key not in ranked or score > ranked[key][0]:
            ranked[key] = (score, template)
    choices = sorted(ranked.values(), key=lambda pair: pair[0], reverse=True)
    if not choices:
        raise ValueError(f"No templates for family {family}")
    score, best = choices[0]
    margin = score - choices[1][0] if len(choices) > 1 else 0.0
    accepted = score >= MIN_SCORE and margin >= MIN_MARGIN
    return {
        "family": family,
        "status": "candidate" if accepted else "unknown",
        "visualId": best["visualId"] if accepted else None,
        "tier": best.get("tier") if accepted else None,
        "reward": best.get("reward") if accepted else None,
        "score": round(score, 4), "margin": round(margin, 4),
        "reason": None if accepted else "low-similarity-or-ambiguous",
    }


def overlap(a: list[int], b: list[int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    intersection = max(0, min(ax + aw, bx + bw) - max(ax, bx)) * max(0, min(ay + ah, by + bh) - max(ay, by))
    return intersection / min(aw * ah, bw * bh)


def scan(image: Image.Image, bank: list[dict], ui_scale: float = 1.0) -> dict:
    if not 0.5 <= ui_scale <= 2:
        raise ValueError("UI scale must be between 0.5 and 2.")
    # Templates use 1080p coordinates. Keep low-resolution source pixels intact.
    factor = min(1.0, 1080 / image.height)
    working = image.resize((round(image.width * factor), round(image.height * factor)), Image.Resampling.LANCZOS)
    pixels = gray(working)
    scale = working.height / 1080 * ui_scale
    proposals = []
    truncated = False
    for template in bank:
        original = template["pixels"]
        tw, th = max(6, round(original.width * scale)), max(6, round(original.height * scale))
        needle = original.resize((tw, th), Image.Resampling.LANCZOS)
        scores = correlation(pixels, gray(needle))
        if not scores.size:
            continue
        # Bound work on repetitive screenshots. Expose truncation, never claim completeness.
        for _ in range(60):
            y, x = np.unravel_index(np.argmax(scores), scores.shape)
            score = float(scores[y, x])
            if score < PROPOSAL_SCORE:
                break
            proposals.append({"family": template["family"], "box": [int(x), int(y), tw, th], "proposalScore": score})
            scores[max(0, y - th // 2):y + th // 2 + 1, max(0, x - tw // 2):x + tw // 2 + 1] = -1
        else:
            truncated = True
    result = []
    for proposal in sorted(proposals, key=lambda item: item["proposalScore"], reverse=True):
        if any(d["family"] == proposal["family"] and overlap(d["workingBox"], proposal["box"]) > 0.35 for d in result):
            continue
        classification = classify(crop(working, proposal["box"]), proposal["family"], bank)
        result.append({**classification, "workingBox": proposal["box"],
                       "box": [round(v / factor) for v in proposal["box"]]})
    for item in result:
        del item["workingBox"]
    return {
        "version": VERSION, "image": {"width": image.width, "height": image.height},
        "uiScale": ui_scale, "reviewed": False, "complete": False,
        "truncated": truncated,
        "limitations": ["Only catalogued visual motifs are proposed; absence does not mean no reward.",
                        "No card association, reward count, combo activation or offered/invoked-row inference.",
                        "Similarity scores are not probabilities. Tiers 1 and above 3 are unsupported."],
        "detections": sorted(result, key=lambda item: (item["box"][1], item["box"][0])),
    }


def draw_result(image: Image.Image, result: dict, destination: Path) -> None:
    accepted = [item for item in result["detections"] if item["status"] == "candidate"]
    # Keep rejected search peaks in JSON; drawing them all would obscure the evidence.
    canvas = Image.new("RGB", (image.width + 360, max(image.height, 160 + len(accepted) * 30)), "#151917")
    canvas.paste(image, (0, 0))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=18)
    small = ImageFont.load_default(size=15)
    left = image.width + 18
    draw.text((left, 18), "Visual candidates", font=font, fill="#63e6be")
    draw.text((left, 48), "Unreviewed prototype output", font=small, fill="white")
    rejected = len(result["detections"]) - len(accepted)
    draw.text((left, 76), f"{rejected} search peaks rejected (JSON)", font=small, fill="#ffbe69")
    for index, item in enumerate(accepted, 1):
        x, y, w, h = item["box"]
        colour = "#63e6be"
        draw.rectangle((x, y, x + w, y + h), outline=colour, width=2)
        draw.text((x, max(0, y - 20)), str(index), font=small, fill=colour, stroke_width=1, stroke_fill="black")
        draw.text((left, 112 + (index - 1) * 30), f'{index}. {item["visualId"]}  {item["score"]:.3f}', font=font, fill="white")
    canvas.save(destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overlay", type=Path)
    parser.add_argument("--ui-scale", type=float, default=1)
    args = parser.parse_args()
    destinations = [args.output] + ([args.overlay] if args.overlay else [])
    if len({p.resolve() for p in destinations + [args.image]}) != len(destinations) + 1:
        parser.error("Input, JSON output and overlay must be different files.")
    image = read_image(args.image)
    result = scan(image, load_bank(), args.ui_scale)
    result["sourceSha256"] = hashlib.sha256(args.image.read_bytes()).hexdigest()
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if args.overlay:
        draw_result(image, result, args.overlay)
    print(json.dumps({"output": str(args.output), "candidates": sum(d["status"] == "candidate" for d in result["detections"]),
                      "unknown": sum(d["status"] == "unknown" for d in result["detections"]), "truncated": result["truncated"]}))


if __name__ == "__main__":
    main()
