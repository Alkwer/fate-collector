"""Rebuild labelled, downscaled fixtures from existing local GGG evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
PRESS_URL = "https://web.poecdn.com/public/news/2026-11-07/Kits_for_press_exc26/PoE1_CovensofUmbra_PressKit.zip"
VIDEO_URL = "https://www.youtube.com/watch?v=8FKW2rKJyxA"


def reward(x: int, y: int, visual_id: str | None, size: int = 24, note: str = "") -> dict:
    return {"family": "reward", "visualId": visual_id, "box": [x - size // 2, y - size // 2, size, size], "note": note}


def tier(x: int, y: int, value: int, width: int = 28, height: int = 34) -> dict:
    return {"family": "tier", "visualId": f"tier-{value}", "box": [x, y, width, height], "tier": value}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("press_directory", type=Path, help="Directory containing the original GGG press-kit PNGs")
    args = parser.parse_args()
    evidence = ROOT.parents[1] / "research/evidence"
    fixtures = ROOT / "fixtures"
    images = fixtures / "images"
    images.mkdir(parents=True, exist_ok=True)
    specs = [
        ("press-offer-a", "reference", args.press_directory / "Fates_UI.png", PRESS_URL, [
            *[tier(x, 448, 2) for x in [550, 775, 1000, 1225]],
            reward(605, 677, "blue-diamond"), reward(643, 677, "gold-stack"),
            reward(830, 677, "gold-grid"), reward(869, 677, "blue-diamond"),
            reward(1073, 677, "blue-diamond"), reward(1279, 677, "blue-diamond"), reward(1318, 677, "gold-ring"),
        ]),
        ("press-offer-b", "reference", args.press_directory / "Fates_UI_2.png", PRESS_URL, [
            *[tier(x, 292, 2) for x in [550, 775, 1000]], tier(1225, 272, 2), tier(887, 703, 2),
            reward(622, 521, "gold-ring"), reward(809, 521, "silver-cluster"), reward(847, 521, "orange-feathers"),
            reward(886, 521, "gold-ring"), reward(1072, 521, "three-gems"), reward(1297, 501, "gold-axe"),
            reward(940, 928, "gold-stack"), reward(980, 928, "gold-ring"),
        ]),
        ("merge-reference", "reference", evidence / "duplicates-after-03h15m03.png", VIDEO_URL + "&t=11703s", [
            tier(571, 212, 3), *[reward(x, 488, "three-gems") for x in [548, 587, 626]],
            reward(665, 488, "gold-grid"), *[reward(x, 488, "blue-diamond") for x in [705, 744, 783]],
            reward(1367, 488, None, note="Desaturated combo state; not a supported colour template."),
        ]),
        ("press-invoke", "validation", args.press_directory / "InvokeFates_2.png", PRESS_URL, [
            tier(572, 213, 2), tier(886, 213, 2), tier(1201, 213, 2), tier(774, 644, 2),
            reward(548, 488, "gold-axe"), reward(587, 488, "gold-grid", note="Currency Items tooltip points to this icon."),
            reward(626, 488, "gold-stack"), reward(1328, 488, None, note="Desaturated ring."),
            reward(1367, 488, None, note="Desaturated orange-feather motif."),
            reward(829, 874, "gold-stack"), reward(868, 874, "orange-feathers"),
        ]),
        ("showcase-before", "holdout", evidence / "showcase-before-07h24m51.png", VIDEO_URL + "&t=26691s", [
            tier(439, 429, 2, 19, 23), tier(589, 429, 2, 19, 23), tier(739, 429, 2, 19, 23),
            reward(464, 584, "blue-diamond", 16),
            reward(490, 584, "blue-diamond", 16), reward(516, 584, "gold-grid", 16),
            reward(640, 584, None, 16, "Lower half covered by presenter window."),
            reward(777, 584, "gold-stack", 16), reward(803, 584, "gold-grid", 16),
        ]),
        ("showcase-merged", "holdout", evidence / "showcase-merged-07h24m55.png", VIDEO_URL + "&t=26695s", [
            tier(380, 140, 3, 19, 23), tier(739, 429, 2, 19, 23),
            reward(365, 327, "gold-grid", 16),
            *[reward(x, 327, "blue-diamond", 16) for x in [391, 417, 469, 495, 521]],
            reward(443, 327, None, 16, "Partly covered by cursor."),
            reward(911, 327, None, 16, "Desaturated combo state."),
            reward(777, 584, "gold-stack", 16), reward(803, 584, "gold-grid", 16),
        ]),
        ("showcase-third", "holdout", evidence / "showcase-third-card-07h25m00.png", VIDEO_URL + "&t=26700s", [
            tier(380, 140, 3, 19, 23), tier(800, 140, 2, 19, 23),
            reward(365, 327, "gold-grid", 16), reward(391, 327, "gold-grid", 16),
            reward(417, 327, "gold-stack", 16),
            *[reward(x, 327, "blue-diamond", 16) for x in [443, 469, 495, 521, 547, 573]],
        ]),
        ("negative-gameplay", "holdout", evidence / "showcase-fated-07h25m55.png", VIDEO_URL + "&t=26755s", []),
        ("unknown-exceptional", "validation", evidence / "exceptional-tooltip-03h14m37.png", VIDEO_URL + "&t=11677s", [
            tier(886, 451, 2), reward(960, 680, None, note="Uncatalogued Exceptional Gem combo icon; cursor nearby."),
        ]),
    ]
    dataset = {"version": 1, "annotationMethod": "Manual visual inspection; pixel boxes approximate to 2-4 px. Tier counts checked on enlarged feather crops, consistent with recorded merge sequence.",
               "holdoutUnit": "DatModz/Octavian showcase scene; adjacent frames are correlated, not independent samples.",
               "unknownPolicy": "Uncatalogued/obscured/desaturated symbols have null visualId. Presenter/tooltip regions are excluded only when explicitly listed.", "images": []}
    for name, split, source, url, labels in specs:
        with Image.open(source) as original:
            size = original.size
            image = original.convert("RGB")
        if image.height > 1080:
            image = image.resize((1920, 1080), Image.Resampling.LANCZOS)
        target = images / f"{name}.png"
        image.save(target)
        dataset["images"].append({"id": name, "split": split, "file": f"images/{name}.png", "sourceUrl": url,
                                  "sourceFile": source.name, "sourceSize": list(size), "size": list(image.size),
                                  "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                                  "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "labels": labels,
                                  "ignoreRegions": []})
    (fixtures / "dataset.json").write_text(json.dumps(dataset, indent=2) + "\n", encoding="utf-8")
    # Training only: the validation/holdout labels never enter template construction.
    selections = [("press-offer-a", 4), ("press-offer-a", 5), ("press-offer-a", 6),
                  ("press-offer-b", 5), ("press-offer-b", 6), ("press-offer-b", 7),
                  ("press-offer-b", 9), ("press-offer-b", 10), ("press-offer-b", 0), ("merge-reference", 0),
                  ("merge-reference", 4)]
    catalog = {"version": 2, "templates": []}
    for source_id, index in selections:
        row = next(row for row in dataset["images"] if row["id"] == source_id)
        label = row["labels"][index]
        catalog["templates"].append({**label, "image": row["file"], "sourceImageId": source_id,
                                     "reward": {"label": "Additional Currency Items", "kind": "unknown", "threshold": None,
                                                "evidence": "press-invoke Currency Items tooltip; does not establish universal kind/threshold."}
                                     if label["visualId"] == "gold-grid" else None})
    (fixtures / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    contact = Image.new("RGB", (100 * len(catalog["templates"]), 130), "#191919")
    draw = ImageDraw.Draw(contact)
    for i, item in enumerate(catalog["templates"]):
        x, y, w, h = item["box"]
        with Image.open(fixtures / item["image"]) as image:
            patch = image.crop((x, y, x + w, y + h)).resize((80, 80))
        contact.paste(patch, (i * 100, 30))
        draw.text((i * 100, 8), item["visualId"], fill="white")
    contact.save(fixtures / "templates-preview.png")


if __name__ == "__main__":
    main()
