import json
import unittest

import numpy as np
from PIL import Image

from evaluate import measure
from recognize import ROOT, classify, classify_region, correlation, crop, load_bank, read_image, scan


class VisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bank = load_bank()

    def test_fft_matches_direct_correlation_including_edges(self):
        rng = np.random.default_rng(42)
        image = rng.random((15, 17))
        template = rng.random((4, 5))
        actual = correlation(image, template)
        centered = template - template.mean()
        expected = np.zeros((12, 13))
        for y in range(12):
            for x in range(13):
                patch = image[y:y + 4, x:x + 5]
                patch = patch - patch.mean()
                expected[y, x] = np.sum(patch * centered) / (np.linalg.norm(patch) * np.linalg.norm(centered))
        np.testing.assert_allclose(actual, expected, atol=1e-10)

    def test_constant_patches_and_oversized_templates_are_safe(self):
        self.assertTrue(np.isfinite(correlation(np.zeros((20, 20)), np.eye(4))).all())
        self.assertFalse(correlation(np.zeros((20, 20)), np.eye(4)).any())
        self.assertEqual(correlation(np.zeros((2, 2)), np.eye(4)).size, 0)
        for colour in ["black", "white", "blue"]:
            prediction = classify(Image.new("RGB", (24, 24), colour), "reward", self.bank)
            self.assertIsNone(prediction["visualId"])
            self.assertIsNone(prediction["reward"])

    def test_ambiguous_templates_do_not_produce_a_claim(self):
        original = self.bank[0]
        ambiguous = [original, {**original, "visualId": "lookalike"}]
        result = classify(original["pixels"], "reward", ambiguous)
        self.assertEqual(result["status"], "unknown")
        self.assertIsNone(result["visualId"])

    def test_unseen_colour_noise_is_not_a_named_reward(self):
        pixels = np.random.default_rng(3).integers(0, 256, (24, 24, 3), dtype=np.uint8)
        result = classify(Image.fromarray(pixels), "reward", self.bank)
        self.assertIsNone(result["visualId"])

    def test_small_video_patch_uses_matching_reference_resolution(self):
        import baseline_v1
        image = read_image(ROOT / "fixtures/images/showcase-before.png")
        patch = crop(image, [456, 576, 16, 16])
        self.assertIsNone(baseline_v1.classify(patch, "reward", baseline_v1.load_bank())["visualId"])
        self.assertEqual(classify(patch, "reward", self.bank)["visualId"], "blue-diamond")

    def test_disabled_grid_remains_unknown_despite_matching_shape(self):
        image = read_image(ROOT / "fixtures/images/merge-reference.png")
        result, _ = classify_region(image, [1355, 476, 24, 24], "reward", self.bank)
        self.assertEqual(result["status"], "unknown")
        self.assertIsNone(result["reward"])
        self.assertEqual(result["reason"], "colour-evidence-missing")

    def test_local_alignment_can_resolve_ambiguity_without_lowering_threshold(self):
        image = read_image(ROOT / "fixtures/images/showcase-third.png")
        box = [409, 318, 16, 16]
        self.assertEqual(classify(crop(image, box), "reward", self.bank)["status"], "unknown")
        result, aligned = classify_region(image, box, "reward", self.bank)
        self.assertEqual(result["visualId"], "gold-stack")
        self.assertGreaterEqual(result["score"], .86)
        self.assertGreaterEqual(result["margin"], .07)
        self.assertEqual(aligned, [409, 319, 16, 16])

    def test_occluded_and_unseen_symbols_still_abstain(self):
        cases = [("showcase-before.png", [632, 576, 16, 16]),
                 ("showcase-merged.png", [435, 319, 16, 16]),
                 ("unknown-exceptional.png", [948, 668, 24, 24])]
        for filename, box in cases:
            with self.subTest(filename=filename):
                result, _ = classify_region(read_image(ROOT / "fixtures/images" / filename), box, "reward", self.bank)
                self.assertEqual(result["status"], "unknown")

    def test_scaled_icon_is_found_without_labelled_coordinates(self):
        original = self.bank[0]
        canvas = Image.new("RGB", (960, 540))
        canvas.paste(original["pixels"].resize((12, 12), Image.Resampling.LANCZOS), (200, 200))
        result = scan(canvas, self.bank)
        candidates = [x for x in result["detections"] if x["status"] == "candidate"]
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["visualId"], "blue-diamond")
        self.assertLessEqual(abs(candidates[0]["box"][0] - 200), 1)
        self.assertFalse(result["reviewed"])
        self.assertFalse(result["complete"])

    def test_crop_does_not_pad_missing_pixels(self):
        with self.assertRaises(ValueError):
            crop(Image.new("RGB", (30, 30)), [25, 25, 24, 24])

    def test_metrics_penalize_duplicates_wrong_classes_and_unknown_claims(self):
        labels = [{"family": "reward", "visualId": "a", "box": [10, 10, 20, 20]},
                  {"family": "reward", "visualId": None, "box": [40, 10, 20, 20]}]
        predictions = [{"family": "reward", "visualId": "a", "box": [10, 10, 20, 20], "score": 1, "status": "candidate"},
                       {"family": "reward", "visualId": "a", "box": [10, 10, 20, 20], "score": .9, "status": "candidate"},
                       {"family": "reward", "visualId": "a", "box": [40, 10, 20, 20], "score": .9, "status": "candidate"}]
        result = measure(labels, predictions, "reward")
        self.assertEqual((result["correct"], result["falseAccepts"], result["unsupportedFalseAccepts"]), (1, 2, 1))
        predictions[0]["visualId"] = "wrong"
        result = measure(labels, predictions[:1], "reward")
        self.assertEqual((result["missed"], result["falseAccepts"]), (1, 1))

    def test_template_sources_are_reference_only_and_unknowns_remain_semantically_unknown(self):
        dataset = json.loads((ROOT / "fixtures/dataset.json").read_text())
        reference = {x["id"] for x in dataset["images"] if x["split"] == "reference"}
        for template in self.bank:
            self.assertIn(template["sourceImageId"], reference)
            if template["family"] == "reward" and template["visualId"] != "gold-grid":
                self.assertIsNone(template["reward"])


if __name__ == "__main__":
    unittest.main()
