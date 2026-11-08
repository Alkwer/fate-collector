import base64
import copy
import hashlib
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from evaluate_offers import accepted, measure_case
from offer_input import load_input, read_capture, validate_ocr
from offers import assemble_offer, normalize
from recognize import ROOT, load_bank, scan


class OfferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ground = json.loads((ROOT / "fixtures/offers-expected.json").read_text(encoding="utf-8"))["images"]
        cls.cases = {}
        bank = load_bank()
        sources = {case["id"]: case["file"] for case in cls.ground}
        sources.update({"atlas": "v2/images/atlas.png", "combat": "v2/images/combat.png"})
        for key, file in sources.items():
            path = ROOT / "fixtures" / file
            image, ocr, _ = load_input(path, ROOT / "fixtures/ocr" / f"{path.stem}.json")
            visual = scan(image, bank)
            cls.cases[key] = (image, ocr, visual, assemble_offer(image, ocr, visual))

    def test_all_six_scenes_keep_grouping_tiers_and_card_symbols(self):
        totals = Counter()
        for ground in self.ground:
            result = self.cases[ground["id"]][3]
            with self.subTest(image=ground["id"]):
                metrics = measure_case(ground, result)
                totals.update(metrics)
                for key in ["cardCountDifference", "wrongNames", "missingCardSymbols",
                            "unexpectedCardSymbols", "unexpectedSharedSymbols", "unassignedCards",
                            "acceptedWhereUnattributable", "acceptedUnassignedSymbols"]:
                    self.assertEqual(metrics.get(key, 0), 0, key)
                self.assertFalse(result["complete"])
                self.assertFalse(result["reviewed"])
        self.assertEqual(totals["locatedCards"], 25)
        self.assertEqual(totals["correctTiers"], 25)
        self.assertEqual(totals["correctNames"], 23)
        self.assertEqual(totals["unknownNames"], 2)
        self.assertEqual(totals["correctCardSymbols"], 33)
        self.assertEqual(totals["correctSharedSymbols"], 2)
        self.assertEqual(totals["missingSharedSymbols"], 1)

    def test_raised_card_and_duplicate_name_belong_to_distinct_rows(self):
        result = self.cases["press-offer-b"][3]
        self.assertEqual([c["name"] for c in result["offered"]],
                         ["Torchbearer", "Tempest", "Stormcaller", "Houndmaster"])
        self.assertEqual([c["name"] for c in result["collected"]], ["Torchbearer"])
        self.assertEqual(accepted(result["offered"][0]["rewardSymbols"]), ["gold-ring"])
        self.assertEqual(accepted(result["collected"][0]["rewardSymbols"]), ["gold-stack", "gold-ring"])

    def test_repeated_symbols_are_not_deduplicated_by_name(self):
        result = self.cases["v2-showcase"][3]
        avalanche = next(c for c in result["offered"] if c["name"] == "Avalanche")
        self.assertEqual(accepted(avalanche["rewardSymbols"]), ["gold-ring", "gold-ring"])

    def test_bad_ocr_names_remain_unknown_with_original_text(self):
        for key, raw in [("v2-showcase", "Dwad"), ("v2-showcase-26600", "Stormcalter")]:
            with self.subTest(image=key):
                card = next(c for c in self.cases[key][3]["offered"] if c["name"] is None)
                self.assertEqual(card["rawNameText"], raw)
                self.assertEqual(card["nameStatus"], "unknown")

    def test_tooltip_suppresses_unsafe_icon_without_creating_a_card(self):
        _, _, visual, result = self.cases["v2-invoke-fates"]
        self.assertTrue(any(d["visualId"] == "gold-axe" for d in visual["detections"]))
        self.assertEqual(accepted(result["sharedRewardSymbols"]), [])
        obscured = [d for d in result["sharedRewardSymbols"] if d["reason"] == "occluded-by-tooltip"]
        self.assertGreaterEqual(len(obscured), 1)
        self.assertTrue(all(d["reward"] is None and d["visualId"] is None for d in obscured))
        self.assertEqual([c["name"] for c in result["invoked"]], ["Tempest", "Houndmaster"])
        self.assertEqual(len(result["collected"]), 2)
        # Assembly must not alter the frozen scanner's result in place.
        self.assertTrue(any(d["visualId"] == "gold-axe" for d in visual["detections"]))

    def test_shared_bar_cannot_be_attributed_to_individual_invoked_cards(self):
        result = self.cases["press-invoke"][3]
        self.assertEqual(accepted(result["sharedRewardSymbols"]), ["gold-axe", "gold-stack"])
        for card in result["invoked"]:
            self.assertEqual(card["rewardSymbols"], [])
            self.assertEqual(card["rewardsStatus"], "shared-not-attributable")

    def test_missing_rewards_do_not_assert_empty_reward_set(self):
        card = self.cases["v2-showcase"][3]["collected"][0]
        self.assertEqual(accepted(card["rewardSymbols"]), [])
        self.assertTrue(all(d["visualId"] is None and d["reward"] is None for d in card["rewardSymbols"]))
        self.assertEqual(card["rewardsStatus"], "unknown")
        self.assertEqual(card["coverage"], "unverified")

    def test_visible_header_preserves_card_when_tier_detection_is_missing(self):
        image, ocr, visual, _ = self.cases["press-offer-b"]
        without_tiers = {**visual, "detections": [d for d in visual["detections"] if d["family"] != "tier"]}
        result = assemble_offer(image, ocr, without_tiers)
        self.assertEqual(len(result["offered"]), 4)
        self.assertEqual(len(result["collected"]), 1)
        for card in result["offered"] + result["collected"]:
            self.assertIsNone(card["tier"])
            self.assertEqual(card["tierStatus"], "unknown")
            self.assertEqual(card["anchor"], "ocr-header")

    def test_unavailable_ocr_and_missing_mode_never_assert_offer(self):
        image, ocr, visual, _ = self.cases["press-offer-a"]
        for changed in [{"status": "unavailable"},
                        {**ocr, "lines": [line for line in ocr["lines"] if normalize(line["text"]) not in {"fates", "selectafate", "selectafa"}]}]:
            result = assemble_offer(image, changed, visual)
            self.assertEqual(result["mode"], "unknown")
            self.assertEqual(result["offered"], [])
            self.assertFalse(result["complete"])

    def test_single_row_without_confirm_stays_unassigned(self):
        image, ocr, visual, _ = self.cases["press-offer-a"]
        changed = {**ocr, "lines": [line for line in ocr["lines"] if "CONFIR" not in line["text"].upper()]}
        result = assemble_offer(image, changed, visual)
        self.assertEqual(result["mode"], "offer")
        self.assertEqual(result["offered"], [])
        self.assertEqual(len(result["unassignedCards"]), 4)

    def test_negative_gameplay_screens_do_not_assert_cards(self):
        for key in ["atlas", "combat"]:
            result = self.cases[key][3]
            self.assertEqual(result["mode"], "unknown")
            for group in ["offered", "collected", "invoked", "unassignedCards"]:
                self.assertEqual(result[group], [])

    def test_truncated_scanner_warning_is_preserved(self):
        image, ocr, visual, _ = self.cases["press-offer-a"]
        result = assemble_offer(image, ocr, {**visual, "truncated": True})
        self.assertTrue(any("truncated" in warning for warning in result["warnings"]))
        self.assertFalse(result["complete"])


class OfferInputTests(unittest.TestCase):
    def test_metrics_count_symbols_on_missing_and_extra_cards(self):
        card = {"name": "Tempest", "tier": 2, "visualIds": ["blue-diamond", "blue-diamond"]}
        expected = {"mode": "offer", "offered": [card], "collected": [], "invoked": [], "sharedVisualIds": []}
        result = {"mode": "offer", "offered": [], "collected": [], "invoked": [],
                  "sharedRewardSymbols": [], "unassignedCards": [], "unassignedSymbols": []}
        metrics = measure_case(expected, result)
        self.assertEqual(metrics["missingCardSymbols"], 2)
        self.assertEqual(metrics["expectedCardSymbols"], 2)
        extra = {"name": "Tempest", "tier": 2, "rewardSymbols": [{"status": "candidate", "visualId": "gold-ring"}]}
        result["offered"] = [extra, extra]
        metrics = measure_case(expected, result)
        self.assertEqual(metrics["unexpectedCardSymbols"], 2)
        self.assertEqual(metrics["cardCountDifference"], 1)

    def test_nonfinite_outside_or_malformed_ocr_is_rejected(self):
        line = {"text": "Fates", "x": 0, "y": 0, "width": 10, "height": 10}
        for key, value in [("x", float("nan")), ("y", -1), ("width", True), ("height", 200)]:
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    validate_ocr({"status": "ok", "lines": [{**line, key: value}]}, (100, 100))
        with self.assertRaises(ValueError):
            validate_ocr({"status": "guessed", "lines": []}, (100, 100))

    def test_ocr_fixture_is_bound_to_exact_pixels(self):
        with self.assertRaisesRegex(ValueError, "exact image"):
            load_input(ROOT / "fixtures/images/press-offer-b.png", ROOT / "fixtures/ocr/press-offer-a.json")

    def test_helper_capture_roundtrip_and_invalid_metadata(self):
        path = ROOT / "fixtures/images/press-offer-b.png"
        ocr = json.loads((ROOT / "fixtures/ocr/press-offer-b.json").read_text(encoding="utf-8"))["ocr"]
        data = path.read_bytes()
        capture = {"kind": "fate-collector.capture", "schemaVersion": 1,
                   "image": {"mimeType": "image/png", "width": 1920, "height": 1080,
                             "dataBase64": base64.b64encode(data).decode("ascii")}, "ocr": ocr}
        scratch = ROOT / "output/test-inputs"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            target = Path(directory) / "capture.json"
            target.write_text(json.dumps(capture), encoding="utf-8")
            image, actual_ocr, digest = read_capture(target)
            self.assertEqual(image.size, (1920, 1080))
            self.assertEqual(actual_ocr, ocr)
            self.assertEqual(digest, hashlib.sha256(data).hexdigest())
            invalid = copy.deepcopy(capture)
            invalid["image"]["width"] = 1921
            target.write_text(json.dumps(invalid), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "dimensions"):
                read_capture(target)


if __name__ == "__main__":
    unittest.main()
