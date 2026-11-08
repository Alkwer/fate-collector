"""Assemble unreviewed whole offers from pixels and positioned local OCR."""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from offer_input import load_input, validate_ocr
from offer_refinement import name_consensus, read_header, refine_icon
from recognize import load_bank, scan, overlap

VERSION = "fate-offer-prototype-2"
# Exact-name recognition only. Snapshot of shared/recognition.ts, extended by two
# names visually observed in the prerelease showcase. No reward/name mapping.
NAMES = ["Alchemist", "Sanguine", "Butcher", "Gravewalker", "Torchbearer", "Tempest",
         "Stormcaller", "Houndmaster", "Bloodthirsty", "Deathbringer", "Conjurer",
         "Wildfire", "Doomsayer", "Incandescent", "Crowkeeper", "Dryad", "Avalanche"]


def normalize(text: str) -> str:
    return re.sub("[^a-z]", "", text.lower())


def box_of(line: dict) -> list[float]:
    return [line["x"], line["y"], line["width"], line["height"]]


def center(box) -> tuple[float, float]:
    return box[0] + box[2] / 2, box[1] + box[3] / 2


def contains(box, point) -> bool:
    x, y = point
    return box[0] <= x <= box[0] + box[2] and box[1] <= y <= box[1] + box[3]


def intersects(a, b) -> bool:
    return min(a[0] + a[2], b[0] + b[2]) > max(a[0], b[0]) and min(a[1] + a[3], b[1] + b[3]) > max(a[1], b[1])


def tooltip_regions(image: Image.Image, ocr: dict, scale: float) -> list[list[int]]:
    """Propose tooltip text blocks, then require a dark pixel panel beneath them.

    Include a title above the paragraph so symbols under translucent title space
    cannot escape the mask. No manual fixture rectangles are used.
    """
    lines = ocr["lines"]
    seeds = [i for i, line in enumerate(lines) if re.search(r"empowered|to claim|number of feathers", line["text"], re.I)]
    result = []
    pixels = np.asarray(image)
    for seed in seeds:
        selected = {seed}
        anchor = lines[seed]["x"]
        changed = True
        while changed:
            changed = False
            for index, line in enumerate(lines):
                if index in selected or abs(line["x"] - anchor) > 14 * scale:
                    continue
                if any(abs(center(box_of(line))[1] - center(box_of(lines[j]))[1]) <= max(55 * scale, 3 * lines[j]["height"]) for j in selected):
                    selected.add(index)
                    changed = True
        chosen = [lines[i] for i in selected]
        x = max(0, int(min(line["x"] for line in chosen) - 10 * scale))
        y = max(0, int(min(line["y"] for line in chosen) - 10 * scale))
        right = min(image.width, int(max(line["x"] + line["width"] for line in chosen) + 10 * scale))
        bottom = min(image.height, int(max(line["y"] + line["height"] for line in chosen) + 10 * scale))
        box = [x, y, right - x, bottom - y]
        if box[2] < 200 * scale or box[3] > 400 * scale or box[2] <= 0 or box[3] <= 0:
            continue
        dark_fraction = float(np.mean(pixels[y:bottom, x:right].max(2) < 32))
        if dark_fraction >= .60 and not any(overlap(box, other) > .8 for other in result):
            result.append(box)
    return result


def layout_mode(ocr: dict, cards: list[dict], scale: float) -> tuple[str, float | None, list[str]]:
    # Require UI-specific text, not the appearance of a card name in a tooltip.
    markers = [normalize(line["text"]) for line in ocr["lines"]]
    if "invokefates" in markers:
        mode = "invoke"
    elif "fates" in markers or any(text in {"selectafate", "selectafa"} for text in markers):
        mode = "offer"
    else:
        return "unknown", None, ["Screen type is not established by OCR."]
    if not cards:
        return mode, None, ["No supported card anchors were found."]
    # Confirm may be partly occluded; use row separation only when the physical
    # card rows are separated by more than a card's height, including rewards.
    confirms = [line["y"] for line in ocr["lines"] if normalize(line["text"]) in {"confirm", "confir"}]
    if confirms:
        # Ignore unrelated text above/below the panel.
        confirms = [y for y in confirms if y > min(c["headerBox"][1] for c in cards)]
    if confirms:
        return mode, min(confirms), []
    ordered = sorted(c["headerBox"][1] for c in cards)
    gaps = [(b - a, (a + 280 * scale + b) / 2) for a, b in zip(ordered, ordered[1:]) if b - a > 300 * scale]
    if len(gaps) == 1:
        return mode, gaps[0][1], ["Confirm text unavailable; separated card rows establish the boundary."]
    return mode, None, ["Offer/collection boundary is uncertain; cards remain unassigned."]


def assemble_offer(image: Image.Image, ocr: dict, visual: dict, ui_scale: float = 1) -> dict:
    ocr = validate_ocr(ocr, image.size)
    scale = image.height / 1080 * ui_scale
    if not .5 <= ui_scale <= 2:
        raise ValueError("UI scale must be between 0.5 and 2.")
    result = {"version": VERSION, "visualVersion": visual["version"], "image": {"width": image.width, "height": image.height},
              "mode": "unknown", "reviewed": False, "complete": False, "offered": [], "collected": [], "invoked": [],
              "unassignedCards": [], "sharedRewardSymbols": [], "unassignedSymbols": [], "occlusions": [], "warnings": []}
    if ocr["status"] != "ok":
        result["warnings"].append("Positioned OCR is unavailable; no offer is asserted.")
        return result
    masks = tooltip_regions(image, ocr, scale)
    result["occlusions"] = masks
    detections = []
    for detection in visual["detections"]:
        if any(intersects(detection["box"], mask) for mask in masks):
            detection = {**detection, "status": "unknown", "visualId": None, "tier": None, "reward": None, "reason": "occluded-by-tooltip"}
        detections.append(detection)
    by_name = {normalize(name): name for name in NAMES}
    cards = []

    def new_card(x, y, tier, anchor):
        return {"name": None, "rawNameText": None, "nameStatus": "unknown", "tier": tier,
                "tierStatus": "candidate" if tier is not None else "unknown", "anchor": anchor,
                "box": [x - 18 * scale, y - 55 * scale, 190 * scale, 308 * scale],
                "headerBox": [x + 8 * scale, y - 46 * scale, 130 * scale, 35 * scale],
                "rewardRegion": [x - 14 * scale, y + 208 * scale, 180 * scale, 42 * scale],
                "rewardSymbols": [], "rewardsStatus": "unknown", "coverage": "unverified", "reviewed": False}

    for detection in detections:
        if detection["family"] != "tier" or detection["status"] != "candidate":
            continue
        x, y = detection["box"][:2]
        card = new_card(x, y, detection["tier"], "feathers")
        lines = [line for line in ocr["lines"] if contains(card["headerBox"], center(box_of(line)))
                 and line["width"] <= 180 * scale and line["height"] <= 30 * scale
                 and not any(intersects(box_of(line), mask) for mask in masks)]
        exact = [line for line in lines if normalize(line["text"]) in by_name]
        raw = exact[0]["text"] if len(exact) == 1 else lines[0]["text"] if len(lines) == 1 else None
        name = by_name.get(normalize(raw or ""))
        cards.append({**card, "name": name, "rawNameText": raw, "nameStatus": "candidate" if name else "unknown"})
    # Missing/unsupported feathers must not delete an otherwise visible card.
    # An exact OCR name plus a parchment header can anchor an unknown-tier card.
    pixels = np.asarray(image)
    for line in ocr["lines"]:
        name = by_name.get(normalize(line["text"]))
        cx, cy = center(box_of(line))
        if not name or any(intersects(box_of(line), mask) for mask in masks):
            continue
        if any(abs(center(c["headerBox"])[0] - cx) < 100 * scale and abs(center(c["headerBox"])[1] - cy) < 60 * scale for c in cards):
            continue
        left, top = max(0, int(cx - 75 * scale)), max(0, int(cy - 14 * scale))
        patch = pixels[top:min(image.height, int(cy + 14 * scale)), left:min(image.width, int(cx + 75 * scale))].astype(float)
        if not patch.size:
            continue
        parchment = (patch[:, :, 0] > 80) & (patch[:, :, 0] > patch[:, :, 1]) & (patch[:, :, 1] > patch[:, :, 2] * 1.08)
        if float(parchment.mean()) < .45:
            continue
        card = new_card(cx - 72 * scale, cy + 28 * scale, None, "ocr-header")
        cards.append({**card, "name": name, "rawNameText": line["text"], "nameStatus": "candidate"})
    mode, boundary, warnings = layout_mode(ocr, cards, scale)
    result["mode"] = mode
    result["warnings"].extend(warnings)
    result["rowBoundary"] = boundary
    for card in sorted(cards, key=lambda c: (round(c["headerBox"][1] / (100 * scale)), c["box"][0])):
        if mode == "unknown" or boundary is None:
            group = "unassignedCards"
        elif center(card["headerBox"])[1] > boundary:
            group = "collected"
        else:
            group = "offered" if mode == "offer" else "invoked"
        result[group].append(card)
        if group == "invoked":
            card["rewardsStatus"] = "shared-not-attributable"
    for group in ["offered", "collected", "invoked", "unassignedCards"]:
        result[group].sort(key=lambda c: c["box"][0])
    for detection in detections:
        if detection["family"] != "reward":
            continue
        point = center(detection["box"])
        owners = [card for card in result["offered"] + result["collected"] if contains(card["rewardRegion"], point)]
        if len(owners) == 1:
            owners[0]["rewardSymbols"].append(detection)
        elif mode == "invoke" and boundary is not None and point[1] < boundary and result["invoked"]:
            bottom = max(card["rewardRegion"][1] for card in result["invoked"])
            if bottom <= point[1] <= bottom + 80 * scale:
                result["sharedRewardSymbols"].append(detection)
            elif detection["status"] == "candidate":
                result["unassignedSymbols"].append(detection)
        elif detection["status"] == "candidate":
            result["unassignedSymbols"].append(detection)
    for card in result["offered"] + result["collected"]:
        card["rewardSymbols"].sort(key=lambda d: d["box"][0])
        hidden = any(intersects(card["rewardRegion"], mask) for mask in masks)
        clipped = card["rewardRegion"][1] + card["rewardRegion"][3] > image.height
        if hidden or clipped:
            card["rewardsStatus"] = "occluded" if hidden else "clipped"
        elif any(d["status"] == "candidate" for d in card["rewardSymbols"]):
            card["rewardsStatus"] = "partial"
        # Empty is unknown, never proof that this card has no rewards.
    result["sharedRewardSymbols"].sort(key=lambda d: d["box"][0])
    if visual.get("truncated"):
        result["warnings"].append("Visual search was truncated; offer is incomplete.")
    result["warnings"].append("Only supported motifs/tiers are detected. Missing symbols or card anchors do not mean absence.")
    return result


def recognize_offer(image: Image.Image, ocr: dict, ui_scale: float = 1, header_reader=None) -> dict:
    bank = load_bank()
    result = assemble_offer(image, ocr, scan(image, bank, ui_scale), ui_scale)
    for group in ["offered", "collected", "invoked"]:
        for card in result[group]:
            card["nameSource"] = "full-frame-ocr" if card["name"] else "unknown"
            if card["name"] is None and header_reader is not None and not any(intersects(card["headerBox"], mask) for mask in result["occlusions"]):
                readings = header_reader(image, card["headerBox"])
                card["headerReadings"] = readings
                decision = name_consensus(card["rawNameText"], readings, NAMES)
                if decision:
                    card.update(name=decision["name"], nameStatus="candidate", nameSource=decision["method"], nameEvidence=decision)
            card["rewardSymbols"] = [refine_icon(image, d, bank) for d in card["rewardSymbols"]]
            if card["rewardsStatus"] == "unknown" and any(d["status"] == "candidate" for d in card["rewardSymbols"]):
                card["rewardsStatus"] = "partial"
    result["sharedRewardSymbols"] = [refine_icon(image, d, bank) for d in result["sharedRewardSymbols"]]
    return result


def draw_offer(image: Image.Image, result: dict, destination: Path) -> None:
    canvas = Image.new("RGB", (image.width + 430, max(image.height, 500)), "#151917")
    canvas.paste(image, (0, 0))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=17)
    small = ImageFont.load_default(size=14)
    left, row = image.width + 16, 18
    draw.text((left, row), f'Offer reader: {result["mode"]}', font=font, fill="white")
    row += 32
    for group, color in [("offered", "#63e6be"), ("collected", "#8ebdff"), ("invoked", "#e6bb63"), ("unassignedCards", "#b1b1b1")]:
        for card in result[group]:
            x, y, w, h = card["box"]
            draw.rectangle((x, y, x + w, y + h), outline=color, width=2)
            name = card["name"] or f'unknown ({card["rawNameText"] or "no OCR"})'
            if card.get("nameSource") == "dictionary-assisted-header-consensus":
                name += "*"
            tier = card["tier"] if card["tier"] is not None else "?"
            draw.text((left, row), f'{group}: {name} / T{tier}', font=font, fill=color)
            labels = [d["visualId"] for d in card["rewardSymbols"] if d["status"] == "candidate"]
            row += 25
            draw.text((left, row), ", ".join(labels) or card["rewardsStatus"], font=small, fill="white")
            row += 32
    if result["sharedRewardSymbols"]:
        labels = [d["visualId"] for d in result["sharedRewardSymbols"] if d["status"] == "candidate"]
        unknowns = sum(d["status"] == "unknown" for d in result["sharedRewardSymbols"])
        draw.text((left, row), "Shared bar (partial):", font=font, fill="#e6bb63")
        row += 25
        draw.text((left, row), ", ".join(labels) or "No accepted symbols", font=small, fill="white")
        row += 24
        draw.text((left, row), f"Unknown search proposals: {unknowns}", font=small, fill="#ffbe69")
        row += 25
    for x, y, w, h in result["occlusions"]:
        draw.rectangle((x, y, x + w, y + h), outline="#ffbe69", width=3)
    if any(card.get("nameSource") == "dictionary-assisted-header-consensus" for group in ["offered", "collected", "invoked"] for card in result[group]):
        draw.text((left, row + 14), "* Dictionary-assisted OCR", font=small, fill="#ffbe69")
        row += 24
    draw.text((left, row + 14), "Unreviewed; incomplete coverage", font=small, fill="#ffbe69")
    canvas.save(destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Screenshot (Windows OCR) or helper capture JSON")
    parser.add_argument("--ocr", type=Path, help="Recorded OCR bound to the exact image")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overlay", type=Path)
    parser.add_argument("--ui-scale", type=float, default=1)
    args = parser.parse_args()
    paths = [args.input, args.output] + ([args.ocr] if args.ocr else []) + ([args.overlay] if args.overlay else [])
    if len({p.resolve() for p in paths}) != len(paths):
        parser.error("Input, OCR, output and overlay must be different files.")
    image, ocr, digest = load_input(args.input, args.ocr)
    result = recognize_offer(image, ocr, args.ui_scale, read_header if os.name == "nt" else None)
    result["sourceSha256"] = digest
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if args.overlay:
        draw_offer(image, result, args.overlay)
    print(json.dumps({"mode": result["mode"], **{key: len(result[key]) for key in ["offered", "collected", "invoked", "unassignedCards"]}, "occlusions": len(result["occlusions"])}))


if __name__ == "__main__":
    main()
