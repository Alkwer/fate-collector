"""Record actual Windows OCR, bound to exact fixture pixels (no manual edits)."""
import hashlib
import json

from offer_input import windows_ocr
from recognize import ROOT, read_image


def main():
    sources = ["images/press-offer-a.png", "images/press-offer-b.png", "images/press-invoke.png",
               "v2/images/showcase.png", "v2/images/showcase-26600.png", "v2/images/invoke-fates.png",
               "v2/images/atlas.png", "v2/images/combat.png", "images/unknown-exceptional.png",
               "images/showcase-before.png", "images/showcase-third.png"]
    target = ROOT / "fixtures/ocr"
    target.mkdir(exist_ok=True)
    for source in sources:
        path = ROOT / "fixtures" / source
        result = windows_ocr(path)
        document = {"kind": "fate-collector.ocr-fixture", "schemaVersion": 1, "file": source,
                    "size": list(read_image(path).size), "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "method": "Windows OCR via local OCR-only adapter; 2x Lanczos below 1080p, coordinates mapped back. Text unedited.", **result}
        (target / f"{path.stem}.json").write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"source": source, "status": result["ocr"]["status"], "text": [line["text"] for line in result["ocr"]["lines"]]}), flush=True)


if __name__ == "__main__":
    main()
