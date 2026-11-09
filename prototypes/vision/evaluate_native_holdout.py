"""Measure the whole-offer prototype on independently annotated native PoE frames."""
import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

from PIL import Image

from evaluate_offers import accepted
from offer_input import read_json, windows_ocr
from offer_refinement import read_header
from offers import VERSION, center, contains, intersects, recognize_offer
from recognize import ROOT, read_image


MANIFEST = ROOT / "fixtures/native-holdout.json"
GROUPS = ("offered", "collected", "invoked")
SCENES = {"offer": "offer", "invoke": "invoke", "negative": "unknown"}
COUNTS = (
    "modeCorrect", "expectedCards", "missingCards", "extraCards", "wrongGroups", "groupAbstentions",
    "expectedKnownNames", "expectedUnknownNames", "correctNames", "wrongNames", "knownNameAbstentions",
    "unknownNameAbstentions", "unsafeUnknownNames", "expectedSymbols", "correctSymbols", "missingSymbols",
    "unexpectedSymbols", "unknownSymbolProposals", "acceptedWhereUnattributable",
    *(f"{group}{measure}" for group in GROUPS for measure in ("Expected", "Correct")),
)


def compare_symbols(counts, expected, detected):
    actual = Counter(accepted(detected))
    counts["unknownSymbolProposals"] += sum(item["status"] == "unknown" for item in detected)
    if expected is None:
        counts["acceptedWhereUnattributable"] += actual.total()
        return
    wanted = Counter(expected)
    counts["expectedSymbols"] += wanted.total()
    counts["correctSymbols"] += (wanted & actual).total()
    counts["missingSymbols"] += (wanted - actual).total()
    counts["unexpectedSymbols"] += (actual - wanted).total()


def measure(sample, result):
    counts = Counter(dict.fromkeys(COUNTS, 0))
    counts["modeCorrect"] = int(SCENES[sample["scene"]] == result["mode"])
    predicted = [(group, card) for group in (*GROUPS, "unassignedCards") for card in result[group]]
    matched = set()
    for expected in sample["cards"]:
        group = expected["group"]
        counts["expectedCards"] += 1
        counts[f"{group}Expected"] += 1
        counts["expectedUnknownNames" if expected["name"] is None else "expectedKnownNames"] += 1
        matches = [i for i, (_, card) in enumerate(predicted)
                   if contains(expected["headerBox"], center(card["headerBox"]))]
        if len(matches) != 1 or matches[0] in matched:
            counts["missingCards"] += 1
            compare_symbols(counts, expected["visualIds"], [])
            continue
        index = matches[0]
        matched.add(index)
        actual_group, card = predicted[index]
        if actual_group == group:
            counts[f"{group}Correct"] += 1
        elif actual_group == "unassignedCards":
            counts["groupAbstentions"] += 1
        else:
            counts["wrongGroups"] += 1
        if expected["name"] is None:
            counts["unknownNameAbstentions" if card["name"] is None else "unsafeUnknownNames"] += 1
        elif card["name"] is None:
            counts["knownNameAbstentions"] += 1
        elif card["name"] == expected["name"]:
            counts["correctNames"] += 1
        else:
            counts["wrongNames"] += 1
        compare_symbols(counts, expected["visualIds"], card["rewardSymbols"])
    for index, (_, card) in enumerate(predicted):
        if index not in matched:
            counts["extraCards"] += 1
            compare_symbols(counts, [], card["rewardSymbols"])
    compare_symbols(counts, sample["sharedVisualIds"], result["sharedRewardSymbols"])
    compare_symbols(counts, [], result["unassignedSymbols"])
    return dict(counts)


def known_image_hashes():
    fixtures = ROOT / "fixtures"
    known = set()
    for name in ("dataset.json", "holdout-v2.json"):
        for row in read_json(fixtures / name)["images"]:
            known.update(row[key] for key in ("sha256", "sourceSha256"))
    archived = json.loads((fixtures / "native-candidates.json").read_text(encoding="utf-8"))
    return known | {row["sha256"] for row in archived}


def load_samples(images, profiles, directory):
    digests, scenes = known_image_hashes(), set()
    samples = []
    for row in images:
        path = (directory / row["file"]).resolve()
        if not path.is_relative_to(directory.resolve()) or path.suffix.lower() != ".png":
            raise ValueError("Use a native PNG within the manifest directory.")
        if row["source"] != "native-game" or row["scene"] not in SCENES:
            raise ValueError(f"{path.name}: expected an offer, invocation or negative native game scene.")
        for field in ("sceneId", "gameBuild", "uiScaleSetting", "captureColorPath"):
            if not isinstance(row[field], str) or not row[field].strip():
                raise ValueError(f"{path.name}: missing {field}.")
        if row["sceneId"] in scenes:
            raise ValueError(f"{path.name}: repeated scene ID.")
        if isinstance(row["prototypeUiScale"], bool) or not 0.5 <= row["prototypeUiScale"] <= 2:
            raise ValueError(f"{path.name}: prototype UI scale must be between 0.5 and 2.")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != row["sha256"] or digest in digests:
            raise ValueError(f"{path.name}: unexpected, duplicate or previously used image hash.")
        with Image.open(path) as image:
            if image.format != "PNG" or list(image.size) != profiles[row["profile"]]["size"]:
                raise ValueError(f"{path.name}: PNG format or image size differs from the native profile.")
            image_width, image_height = image.size
        if type(row["tooltip"]) is not bool or bool(row["cards"]) != (row["scene"] != "negative"):
            raise ValueError(f"{path.name}: scene needs matching manual annotations.")
        required_group = {"offer": "offered", "invoke": "invoked"}.get(row["scene"])
        if required_group and not any(card["group"] == required_group for card in row["cards"]):
            raise ValueError(f"{path.name}: missing {required_group} card annotations.")
        if row["scene"] == "negative" and (row["tooltip"] or row["sharedVisualIds"] != []):
            raise ValueError(f"{path.name}: negative frames cannot annotate Fate tooltips or symbols.")
        boxes = []
        for card in row["cards"]:
            if card["group"] not in GROUPS or len(card["headerBox"]) != 4:
                raise ValueError(f"{path.name}: invalid card group or header box.")
            x, y, width, height = card["headerBox"]
            if (not all(math.isfinite(v) for v in card["headerBox"]) or min(x, y) < 0 or min(width, height) <= 0
                    or x + width > image_width or y + height > image_height):
                raise ValueError(f"{path.name}: card header box lies outside the image.")
            if any(intersects(card["headerBox"], box) for box in boxes):
                raise ValueError(f"{path.name}: card header boxes overlap.")
            boxes.append(card["headerBox"])
        digests.add(digest)
        scenes.add(row["sceneId"])
        samples.append((row, path))
    return samples


def coverage(profiles, rows):
    missing = [f"{profile}/{scene}" for profile in profiles for scene in SCENES
               if not any(row["profile"] == profile and row["scene"] == scene for row in rows)]
    positives = [row for row in rows if row["scene"] != "negative"]
    if not any(row["tooltip"] for row in positives):
        missing.append("positive/tooltip")
    if not any(any(card["name"] is None for card in row["cards"]) for row in positives):
        missing.append("positive/unknown-name")
    if not any(any(card["group"] == "collected" for card in row["cards"]) for row in positives):
        missing.append("positive/collected-row")
    return missing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--require-coverage", action="store_true", help="Exit 1 if a required case was not measured.")
    args = parser.parse_args()
    plan = read_json(MANIFEST)
    profiles = {row["id"]: row for row in plan["profiles"]}
    dataset = read_json(args.manifest)
    if dataset.get("schemaVersion") != 1:
        parser.error("Expected native holdout manifest schema version 1.")
    samples = load_samples(dataset["images"], profiles, args.manifest.parent)
    report = {"pipeline": VERSION, "profiles": plan["profiles"],
              "manifestSha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(), "images": []}
    measured, totals = [], Counter()
    for sample, path in samples:
        ocr = windows_ocr(path)["ocr"]
        row = {**sample, "ocrStatus": ocr["status"]}
        if ocr["status"] == "ok":
            result = recognize_offer(read_image(path), ocr, sample["prototypeUiScale"], header_reader=read_header)
            row["metrics"] = measure(sample, result)
            totals.update(row["metrics"])
            measured.append(sample)
        report["images"].append(row)
    report["summary"] = dict(totals)
    report["measuredImages"] = len(measured)
    report["missingCoverage"] = coverage(profiles, measured)
    print(json.dumps(report, indent=2))
    return int(args.require_coverage and bool(report["missingCoverage"]))


if __name__ == "__main__":
    raise SystemExit(main())
