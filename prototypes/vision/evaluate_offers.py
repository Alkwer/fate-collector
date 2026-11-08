"""Compare whole offers with manual labels, using unedited real Windows OCR."""
import json
from collections import Counter

from offer_input import load_input
from offers import recognize_offer, draw_offer
from recognize import ROOT


def accepted(symbols):
    return [d["visualId"] for d in symbols if d["status"] == "candidate"]


def measure_case(expected, result):
    counts = Counter()
    counts["modeCorrect"] = int(expected["mode"] == result["mode"])
    for group in ["offered", "collected", "invoked"]:
        wanted, actual = expected[group], result[group]
        counts["expectedCards"] += len(wanted)
        counts["cardCountDifference"] += abs(len(wanted) - len(actual))
        for index, ground in enumerate(wanted):
            target = Counter(ground["visualIds"] or [])
            counts["expectedCardSymbols"] += sum(target.values())
            if index >= len(actual):
                counts["missingCardSymbols"] += sum(target.values())
                continue
            card = actual[index]
            counts["locatedCards"] += 1
            counts["correctNames"] += int(ground["name"] == card["name"])
            counts["unknownNames"] += int(card["name"] is None)
            counts["wrongNames"] += int(card["name"] is not None and card["name"] != ground["name"])
            counts["correctTiers"] += int(ground["tier"] == card["tier"])
            got = Counter(accepted(card["rewardSymbols"]))
            if ground["visualIds"] is None:
                counts["acceptedWhereUnattributable"] += sum(got.values())
            else:
                counts["correctCardSymbols"] += sum((target & got).values())
                counts["missingCardSymbols"] += sum((target - got).values())
                counts["unexpectedCardSymbols"] += sum((got - target).values())
        for card in actual[len(wanted):]:
            counts["unexpectedCardSymbols"] += len(accepted(card["rewardSymbols"]))
    target = Counter(expected["sharedVisualIds"])
    got = Counter(accepted(result["sharedRewardSymbols"]))
    counts["expectedSharedSymbols"] = sum(target.values())
    counts["correctSharedSymbols"] = sum((target & got).values())
    counts["missingSharedSymbols"] = sum((target - got).values())
    counts["unexpectedSharedSymbols"] = sum((got - target).values())
    counts["unassignedCards"] = len(result["unassignedCards"])
    counts["acceptedUnassignedSymbols"] = len(accepted(result["unassignedSymbols"]))
    return dict(counts)


def main():
    dataset = json.loads((ROOT / "fixtures/offers-expected.json").read_text(encoding="utf-8"))
    output = ROOT / "output/offers"
    output.mkdir(parents=True, exist_ok=True)
    rows, totals = [], Counter()
    for expected in dataset["images"]:
        path = ROOT / "fixtures" / expected["file"]
        image, ocr, digest = load_input(path, ROOT / "fixtures/ocr" / f"{path.stem}.json")
        result = recognize_offer(image, ocr)
        result["sourceSha256"] = digest
        (output / f'{expected["id"]}.json').write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        draw_offer(image, result, output / f'{expected["id"]}.png')
        metrics = measure_case(expected, result)
        rows.append({"image": expected["id"], "metrics": metrics})
        totals.update(metrics)
        print(json.dumps(rows[-1]), flush=True)
    report = {"scope": "Six related prerelease scenes; real Windows OCR with recorded pixel binding. Development evaluation, not an untouched holdout.",
              "imageCount": len(rows), "summary": dict(totals), "images": rows}
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
