"""Check original 4K press PNGs: native pixels of known scenes, not a new holdout."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from evaluate_offers import measure_case
from evaluate_offers_v2 import json_write
from offer_input import windows_ocr
from offer_refinement import read_header
from offers import VERSION, recognize_offer
from recognize import ROOT, read_image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("press_directory", type=Path)
    args = parser.parse_args()
    ground = {row["id"]: row for row in json.loads((ROOT / "fixtures/offers-expected.json").read_text(encoding="utf-8"))["images"]}
    sources = []
    for file in ["dataset.json", "holdout-v2.json"]:
        sources += json.loads((ROOT / "fixtures" / file).read_text(encoding="utf-8"))["images"]
    output = ROOT / "output/native-press"
    output.mkdir(parents=True, exist_ok=True)
    rows, totals = [], Counter()
    for source in sources:
        if source["id"] not in {"press-offer-a", "press-offer-b", "press-invoke", "v2-invoke-fates"}:
            continue
        path = args.press_directory / source["sourceFile"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != source["sourceSha256"]:
            raise ValueError("Press source no longer matches the original hash.")
        image = read_image(path)
        record = windows_ocr(path, enlarge_small=False)
        result = recognize_offer(image, record["ocr"], header_reader=read_header)
        json_write(output / f'{source["id"]}.ocr.json', {**record, "sourceSha256": digest})
        json_write(output / f'{source["id"]}.json', result)
        metrics = measure_case(ground[source["id"]], result)
        row = {"image": source["id"], "sourceSha256": digest, "size": list(image.size),
               "ocrStatus": record["ocr"]["status"], "ocrResizeFactor": record["ocrResizeFactor"], "metrics": metrics}
        rows.append(row)
        totals.update(metrics)
        print(json.dumps(row), flush=True)
    json_write(output / "metrics.json", {"version": VERSION, "scope": __doc__, "images": rows, "summary": dict(totals)})


if __name__ == "__main__":
    main()
