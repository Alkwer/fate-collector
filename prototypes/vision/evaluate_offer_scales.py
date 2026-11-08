"""Controlled resized-frame checks with a fresh Windows OCR call for every image."""
import hashlib
import json

from PIL import Image

from evaluate_offers import measure_case
from offer_input import load_input, windows_ocr
from offers import recognize_offer, draw_offer
from recognize import ROOT, read_image


def main():
    ground = json.loads((ROOT / "fixtures/offers-expected.json").read_text(encoding="utf-8"))["images"]
    output = ROOT / "output/offer-scales"
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    for expected in ground:
        if expected["id"] not in {"press-offer-b", "v2-invoke-fates"}:
            continue
        original = read_image(ROOT / "fixtures" / expected["file"])
        for height in [720, 1440, 2160]:
            size = (round(original.width * height / original.height), height)
            path = output / f'{expected["id"]}-{height}.png'
            original.resize(size, Image.Resampling.LANCZOS).save(path)
            record = windows_ocr(path)
            # Record this actual OCR pass; do not run it a second time.
            record.update({"kind": "fate-collector.ocr-fixture", "schemaVersion": 1,
                           "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size": list(size)})
            ocr_path = path.with_suffix(".ocr.json")
            ocr_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            image, ocr, _ = load_input(path, ocr_path)
            result = recognize_offer(image, ocr)
            path.with_suffix(".result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
            draw_offer(image, result, path.with_suffix(".overlay.png"))
            row = {"source": expected["id"], "size": size, "metrics": measure_case(expected, result),
                   "occlusions": len(result["occlusions"]), "ocrResizeFactor": record["ocrResizeFactor"]}
            rows.append(row)
            print(json.dumps(row), flush=True)
    report = {"scope": "Synthetic Lanczos resizes of two development frames, each passed through real Windows OCR; not independent gameplay captures.", "images": rows}
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
