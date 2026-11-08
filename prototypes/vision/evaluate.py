"""Evaluate full-scene detection and labelled-patch abstention separately."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import recognize
from recognize import ROOT, crop, overlap, read_image


def measure(labels: list[dict], detections: list[dict], family: str) -> dict:
    expected = [x for x in labels if x["family"] == family and x["visualId"] is not None]
    unknown = [x for x in labels if x["family"] == family and x["visualId"] is None]
    accepted = sorted([x for x in detections if x["family"] == family and x["status"] == "candidate"],
                      key=lambda x: x["score"], reverse=True)
    matched = set()
    true_positive = false_positive = false_unknown = 0
    for detection in accepted:
        matches = [(i, label) for i, label in enumerate(expected) if i not in matched
                   and label["visualId"] == detection["visualId"] and overlap(label["box"], detection["box"]) >= 0.5]
        if matches:
            index, _ = max(matches, key=lambda pair: overlap(pair[1]["box"], detection["box"]))
            matched.add(index)
            true_positive += 1
        else:
            false_positive += 1
            if any(overlap(x["box"], detection["box"]) >= 0.5 for x in unknown):
                false_unknown += 1
    return {"knownTargets": len(expected), "correct": true_positive, "falseAccepts": false_positive,
            "missed": len(expected) - true_positive, "unsupportedTargets": len(unknown),
            "unsupportedFalseAccepts": false_unknown,
            "unknownProposals": sum(x["status"] == "unknown" and x["family"] == family for x in detections)}


def percentages(counts: dict) -> dict:
    accepted = counts["correct"] + counts["falseAccepts"]
    return {**counts, "precision": round(counts["correct"] / accepted, 4) if accepted else None,
            "recall": round(counts["correct"] / counts["knownTargets"], 4) if counts["knownTargets"] else None}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "output")
    parser.add_argument("--split", choices=["all", "reference", "validation", "holdout", "holdout-v2"], default="all")
    parser.add_argument("--dataset", type=Path, default=ROOT / "fixtures/dataset.json")
    parser.add_argument("--baseline-v1", action="store_true", help="Run the preserved V1 code and template bank.")
    args = parser.parse_args()
    # A mistyped output directory must not overwrite fixtures or source files.
    protected = [ROOT, ROOT / "fixtures", ROOT / "fixtures/images"]
    if args.output_dir.resolve() in {p.resolve() for p in protected}:
        parser.error("Choose a dedicated output directory, not the prototype/fixtures directory.")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    model = recognize
    if args.baseline_v1:
        import baseline_v1
        model = baseline_v1
    dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
    bank = model.load_bank()
    training_dataset = json.loads((ROOT / "fixtures/dataset.json").read_text(encoding="utf-8"))
    reference_ids = {row["id"] for row in training_dataset["images"] if row["split"] == "reference"}
    if any(entry["sourceImageId"] not in reference_ids for entry in bank):
        raise ValueError("A template leaks a validation/holdout image.")
    hashes = [row["sha256"] for row in dataset["images"]]
    if len(hashes) != len(set(hashes)):
        raise ValueError("Duplicate images in dataset.")
    if args.dataset.resolve() != (ROOT / "fixtures/dataset.json").resolve():
        old_hashes = {row["sha256"] for row in training_dataset["images"]}
        if old_hashes.intersection(hashes):
            raise ValueError("New evaluation contains a previously used image.")
    totals: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    rows = []
    for spec in dataset["images"]:
        if args.split != "all" and spec["split"] != args.split:
            continue
        path = ROOT / "fixtures" / spec["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != spec["sha256"]:
            raise ValueError(f"Fixture hash mismatch: {path}")
        image = read_image(path)
        result = model.scan(image, bank)
        result["sourceSha256"] = spec["sha256"]
        (args.output_dir / f'{spec["id"]}.json').write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        model.draw_result(image, result, args.output_dir / f'{spec["id"]}.png')
        measurements = {}
        for family in ["tier", "reward"]:
            counts = measure(spec["labels"], result["detections"], family)
            measurements[family] = percentages(counts)
            for key, value in counts.items():
                totals[spec["split"]][family][key] += value
        patches = []
        for label in spec["labels"]:
            prediction = model.classify(crop(image, label["box"]), label["family"], bank)
            patches.append({"expected": label["visualId"], "family": label["family"],
                            "box": label["box"], "prediction": prediction})
        rows.append({"image": spec["id"], "split": spec["split"], "truncated": result["truncated"],
                     "scan": measurements, "labelledPatchResults": patches})
        print(json.dumps({"image": spec["id"], "scan": measurements}), flush=True)
    report = {"version": model.VERSION, "thresholds": {"score": model.MIN_SCORE, "margin": model.MIN_MARGIN, "proposal": model.PROPOSAL_SCORE},
              "datasetSha256": hashlib.sha256(args.dataset.read_bytes()).hexdigest(),
              "scope": "Full screenshot scan; known labels require correct family/class and >=50% smaller-box overlap, one-to-one. Wrong classes count as FP plus FN.",
              "independence": dataset.get("holdoutUnit", "Related prerelease assets, not independent live-game observations."),
              "oldHoldoutIsDevelopmentForV2": not args.baseline_v1,
              "summary": {split: {family: percentages(dict(counts)) for family, counts in families.items()} for split, families in totals.items()},
              "images": rows}
    (args.output_dir / "metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
