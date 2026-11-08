"""Evaluate refinements, preserving original OCR and recording extra header reads."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from evaluate_offers import measure_case
from offer_input import load_input, windows_ocr
from offer_refinement import read_header
from offers import VERSION, draw_offer, recognize_offer
from recognize import ROOT, read_image


def json_write(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def header_reader(image_path, *, record=False):
    digest = hashlib.sha256(image_path.read_bytes()).hexdigest()
    target = ROOT / "fixtures/ocr-headers" / f"{image_path.stem}.json"
    document = {"kind": "fate-collector.header-ocr-fixture", "sourceSha256": digest, "readings": []}
    if not record and target.exists():
        document = json.loads(target.read_text(encoding="utf-8"))
        if document.get("sourceSha256") != digest:
            raise ValueError("Header OCR belongs to different pixels.")

    def reader(image, box):
        if record:
            texts = read_header(image, box)
            document["readings"].append({"box": box, "texts": texts})
            target.parent.mkdir(parents=True, exist_ok=True)
            json_write(target, document)
            return texts
        matches = [row for row in document["readings"] if row["box"] == box]
        if len(matches) != 1:
            raise ValueError("Missing or ambiguous header OCR; run with --record-headers on Windows.")
        return matches[0]["texts"]
    return reader


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record-headers", action="store_true")
    parser.add_argument("--native-directory", type=Path, help="Directory containing the manually inspected native negatives to run through Windows OCR.")
    args = parser.parse_args()
    output = ROOT / "output/offers-v2"
    output.mkdir(parents=True, exist_ok=True)
    ground = json.loads((ROOT / "fixtures/offers-expected.json").read_text(encoding="utf-8"))["images"]
    rows, totals = [], Counter()
    for expected in ground:
        path = ROOT / "fixtures" / expected["file"]
        image, ocr, digest = load_input(path, ROOT / "fixtures/ocr" / f"{path.stem}.json")
        result = recognize_offer(image, ocr, header_reader=header_reader(path, record=args.record_headers))
        result["sourceSha256"] = digest
        json_write(output / f'{expected["id"]}.json', result)
        draw_offer(image, result, output / f'{expected["id"]}.png')
        metrics = measure_case(expected, result)
        rows.append({"image": expected["id"], "metrics": metrics})
        totals.update(metrics)
        print(json.dumps(rows[-1]), flush=True)
    report = {"version": VERSION, "scope": "Six existing development scenes. Native positive holdout is unavailable.",
              "summary": dict(totals), "images": rows}
    json_write(output / "metrics.json", report)
    if args.native_directory:
        candidates = json.loads((ROOT / "fixtures/native-candidates.json").read_text(encoding="utf-8"))
        native = []
        for candidate in candidates:
            if candidate["label"] != "negative":
                continue
            path = args.native_directory / candidate["file"]
            if hashlib.sha256(path.read_bytes()).hexdigest() != candidate["sha256"]:
                raise ValueError("Native screenshot changed since annotation.")
            image = read_image(path)
            record = windows_ocr(path, enlarge_small=False)
            json_write(output / f"native-{path.stem}.ocr.json", {**record, "sourceSha256": candidate["sha256"]})
            result = recognize_offer(image, record["ocr"], header_reader=read_header)
            json_write(output / f"native-{path.stem}.result.json", result)
            row = {"file": path.name, "sha256": candidate["sha256"], "size": list(image.size),
                   "fileModifiedAt": candidate["modified_local"], "ocrStatus": record["ocr"]["status"],
                   "ocrResizeFactor": record["ocrResizeFactor"], "mode": result["mode"],
                   "cards": sum(len(result[key]) for key in ["offered", "collected", "invoked", "unassignedCards"]),
                   "acceptedSymbols": len([d for d in result["unassignedSymbols"] if d["status"] == "candidate"])}
            native.append(row)
            print(json.dumps({"native": row}), flush=True)
        json_write(output / "native-metrics.json", {"version": VERSION,
                   "scope": "Six genuine local 2024 screenshots, newly tested at original 3840x2160 resolution. Negative scenes only; cannot establish Fate-panel recall.", "images": native})


if __name__ == "__main__":
    main()
