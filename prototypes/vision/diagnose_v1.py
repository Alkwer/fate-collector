"""Reproduce every V1 omission on the former holdout (now development data)."""
import json
from collections import Counter
from pathlib import Path

from PIL import Image

import baseline_v1 as v1
import recognize as v2


def rank_native(patch, bank):
    ranked = {}
    for template in bank:
        if template["family"] != "reward":
            continue
        resized = template["pixels"].resize(patch.size, Image.Resampling.LANCZOS)
        score = v1.similarity(patch, resized)
        key = template["visualId"]
        ranked[key] = max(ranked.get(key, -1), score)
    choices = sorted(ranked.items(), key=lambda pair: pair[1], reverse=True)
    key, score = choices[0]
    margin = score - choices[1][1]
    return {"visualId": key, "score": round(score, 4), "margin": round(margin, 4),
            "accepted": score >= v1.MIN_SCORE and margin >= v1.MIN_MARGIN}


def main():
    dataset = json.loads((v1.ROOT / "fixtures/dataset.json").read_text(encoding="utf-8"))
    bank1, bank2 = v1.load_bank(), v2.load_bank()
    omissions = []
    for spec in dataset["images"]:
        if spec["split"] != "holdout" or not spec["labels"]:
            continue
        image = v1.read_image(v1.ROOT / "fixtures" / spec["file"])
        old = v1.scan(image, bank1)["detections"]
        new = v2.scan(image, bank2)["detections"]
        for index, label in enumerate(spec["labels"]):
            if label["family"] != "reward" or label["visualId"] is None:
                continue
            nearby = [d for d in old if d["family"] == "reward" and v1.overlap(label["box"], d["box"]) >= .5]
            if any(d["visualId"] == label["visualId"] for d in nearby):
                continue
            proposal = max(nearby, key=lambda d: d["score"]) if nearby else None
            native = rank_native(v1.crop(image, proposal["box"]), bank1) if proposal else None
            resolved = [d for d in new if d["family"] == "reward" and d["visualId"] == label["visualId"]
                        and v1.overlap(label["box"], d["box"]) >= .5]
            reason = "resolution-mismatch" if native and native["accepted"] and native["visualId"] == label["visualId"] else "invoked-variant-and-alignment" if proposal else "not-localized"
            omissions.append({"id": f'{spec["id"]}:{index}', "image": spec["id"], "expected": label["visualId"],
                              "annotatedBox": label["box"], "v1Proposal": proposal,
                              "equalResolutionAblation": native, "cause": reason,
                              "v2Match": resolved[0] if resolved else None})
    report = {"baseline": v1.VERSION, "newVersion": v2.VERSION, "scope": "Former V1 holdout is V2 development data.",
              "omissionCount": len(omissions), "localizedInV1": sum(x["v1Proposal"] is not None for x in omissions),
              "recoveredInV2": sum(x["v2Match"] is not None for x in omissions),
              "causes": dict(Counter(x["cause"] for x in omissions)), "omissions": omissions}
    destination = v1.ROOT / "diagnosis-v1-18.json"
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "omissions"}, indent=2))


if __name__ == "__main__":
    main()
