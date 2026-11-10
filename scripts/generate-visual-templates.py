"""Generate the browser template bank from the frozen visual catalog (requires Pillow)."""

import argparse
import base64
import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "prototypes/vision/fixtures"
DESTINATION = ROOT / "shared/visual-templates.json"


def generate() -> str:
    catalog_bytes = (FIXTURES / "catalog.json").read_bytes()
    catalog = json.loads(catalog_bytes)
    templates = []
    sources = {}
    for entry in catalog["templates"]:
        source = entry["image"]
        path = FIXTURES / source
        if source not in sources:
            sources[source] = hashlib.sha256(path.read_bytes()).hexdigest()
        x, y, width, height = entry["box"]
        with Image.open(path) as image:
            if min(x, y) < 0 or min(width, height) <= 0 or x + width > image.width or y + height > image.height:
                raise ValueError(f"Invalid catalog box for {source}: {entry['box']}")
            pixels = image.crop((x, y, x + width, y + height)).convert("RGB").tobytes()
        templates.append({
            "family": entry["family"],
            "visualId": entry["visualId"],
            "source": source,
            "box": entry["box"],
            "rgbBase64": base64.b64encode(pixels).decode("ascii"),
        })
        if "tier" in entry:
            templates[-1]["tier"] = entry["tier"]
    return json.dumps({
        "catalogSha256": hashlib.sha256(catalog_bytes).hexdigest(),
        "sources": sources,
        "templates": templates,
    }, indent=2) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify the checked-in bank without writing it.")
    args = parser.parse_args()
    generated = generate()
    if args.check:
        if DESTINATION.read_text(encoding="utf-8") != generated:
            parser.exit(1, "The checked-in browser template bank differs from the catalog.\n")
    else:
        DESTINATION.write_text(generated, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
