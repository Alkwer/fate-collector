"""Generate the browser template bank from the frozen visual catalog (requires Pillow)."""

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "prototypes/vision/fixtures"
DESTINATION = ROOT / "shared/visual-templates.json"
REWARD_ICONS = ROOT / "shared/reward-icons.json"


def generate_reward_icons() -> str:
    # Display references only: these crops do not extend the recognition bank.
    references = [
        ("item-rarity", "prototypes/vision/fixtures/v2/images/invoke-fates.png", [626, 847, 34, 36]),
        ("exceptional-gem", "research/evidence/exceptional-combo-03h14m42.png", [531, 472, 34, 30]),
        ("dreadmaidens-sacrament", "research/evidence/item-rarity-03h13m57.png", [851, 857, 34, 36]),
    ]
    icons = []
    for reward_id, source, box in references:
        path = ROOT / source
        x, y, width, height = box
        with Image.open(path) as image:
            output = io.BytesIO()
            crop = image.crop((x, y, x + width, y + height)).convert("RGB")
            # Strip inherited metadata and use stored DEFLATE blocks. Different
            # platform zlib builds otherwise produce different compressed bytes
            # for identical pixels, breaking the cross-platform --check.
            Image.frombytes("RGB", crop.size, crop.tobytes()).save(output, format="PNG", compress_level=0)
        icons.append({"id": reward_id, "source": source, "box": box,
                      "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                      "pngBase64": base64.b64encode(output.getvalue()).decode("ascii")})
    return json.dumps({"icons": icons}, indent=2) + "\n"


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
    for destination, generated in [(DESTINATION, generate()), (REWARD_ICONS, generate_reward_icons())]:
        if args.check:
            if destination.read_text(encoding="utf-8") != generated:
                parser.exit(1, f"The checked-in {destination.name} differs from its source crops.\n")
        else:
            destination.write_text(generated, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
