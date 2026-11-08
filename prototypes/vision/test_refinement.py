import json
import unittest

from evaluate_offers import accepted, measure_case
from evaluate_offers_v2 import header_reader
from offer_input import load_input
from offer_refinement import name_consensus, refine_icon
from offers import NAMES, recognize_offer
from recognize import ROOT, classify, crop, load_bank, read_image


class RefinementTests(unittest.TestCase):
    def test_consensus_requires_two_compatible_unambiguous_readings(self):
        self.assertEqual(name_consensus("Dwad", ["Dtyad", "Dtyad"], NAMES)["name"], "Dryad")
        self.assertEqual(name_consensus("Stormcalter", ["Stormca!tet:", "St0rmcaltet:"], NAMES)["name"], "Stormcaller")
        for raw, readings in [("Dwad", ["Dtyad"]), ("Dwad", ["Dtyad", ""]),
                              ("Dwad", ["Dryad", "Tempest"]), ("Sanguine", ["Dryad", "Dryad"]),
                              ("Dread", ["Dread", "Dread"]), ("XYZ", ["XYZ", "XYZ"])]:
            with self.subTest(raw=raw, readings=readings):
                self.assertIsNone(name_consensus(raw, readings, NAMES))
        self.assertIsNone(name_consensus("Dryad", ["Dryad", "Dryad"], NAMES + ["Dryed"]))

    def test_icon_interior_recovers_cursor_border_but_not_occlusion_or_gray(self):
        image = read_image(ROOT / "fixtures/images/press-invoke.png")
        bank = load_bank()
        box = [575, 476, 24, 24]
        original = {**classify(crop(image, box), "reward", bank), "box": box}
        self.assertIsNone(original["visualId"])
        result = refine_icon(image, original, bank)
        self.assertEqual(result["visualId"], "gold-grid")
        self.assertGreaterEqual(min(result["interiorScores"]), .90)
        for reason in ["colour-evidence-missing", "occluded-by-tooltip"]:
            self.assertIsNone(refine_icon(image, {**original, "reason": reason}, bank)["visualId"])
        gray = image.convert("L").convert("RGB")
        self.assertIsNone(refine_icon(gray, original, bank)["visualId"])

    def test_uncatalogued_or_covered_patches_do_not_gain_a_label(self):
        bank = load_bank()
        for file, box in [("unknown-exceptional.png", [948, 668, 24, 24]),
                          ("showcase-merged.png", [435, 319, 16, 16]),
                          ("showcase-before.png", [632, 576, 16, 16])]:
            image = read_image(ROOT / "fixtures/images" / file)
            original = {**classify(crop(image, box), "reward", bank), "box": box}
            self.assertIsNone(refine_icon(image, original, bank)["visualId"])

    def test_whole_offer_repairs_three_omissions_and_keeps_tooltip_unknown(self):
        ground = json.loads((ROOT / "fixtures/offers-expected.json").read_text(encoding="utf-8"))["images"]
        totals = {"correctNames": 0, "correctCardSymbols": 0, "correctSharedSymbols": 0}
        for expected in ground:
            path = ROOT / "fixtures" / expected["file"]
            image, ocr, _ = load_input(path, ROOT / "fixtures/ocr" / f"{path.stem}.json")
            result = recognize_offer(image, ocr, header_reader=header_reader(path))
            metrics = measure_case(expected, result)
            with self.subTest(image=expected["id"]):
                for key in ["unknownNames", "wrongNames", "missingCardSymbols", "missingSharedSymbols",
                            "unexpectedCardSymbols", "unexpectedSharedSymbols", "acceptedUnassignedSymbols",
                            "cardCountDifference", "acceptedWhereUnattributable"]:
                    self.assertEqual(metrics.get(key, 0), 0, key)
                for key in totals:
                    totals[key] += metrics[key]
                for card in result["offered"]:
                    if card["nameSource"] == "dictionary-assisted-header-consensus":
                        self.assertIn(card["rawNameText"], ["Dwad", "Stormcalter"])
                        self.assertFalse(card["reviewed"])
        self.assertEqual(totals, {"correctNames": 25, "correctCardSymbols": 33, "correctSharedSymbols": 3})


if __name__ == "__main__":
    unittest.main()
