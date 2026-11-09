import hashlib
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

from evaluate_native_holdout import MANIFEST, coverage, load_samples, measure
from offer_input import read_json
from recognize import ROOT


class NativeHoldoutTests(unittest.TestCase):
    def test_empty_inventory_reports_each_required_case(self):
        profiles = {row["id"]: row for row in read_json(MANIFEST)["profiles"]}
        missing = coverage(profiles, [])
        self.assertEqual(len(missing), 15)
        self.assertIn("4k-hdr-default/offer", missing)
        self.assertIn("positive/collected-row", missing)
        self.assertIn("positive/unknown-name", missing)

    def test_rejects_previously_used_pixels_even_if_declared_native(self):
        row = read_json(ROOT / "fixtures/dataset.json")["images"][0]
        sample = {
            "file": row["file"], "sha256": row["sha256"], "source": "native-game",
            "scene": "offer", "sceneId": "a", "gameBuild": "test", "uiScaleSetting": "default",
            "captureColorPath": "test", "prototypeUiScale": 1,
        }
        with self.assertRaisesRegex(ValueError, "previously used image hash"):
            load_samples([sample], {}, ROOT / "fixtures")

    def test_checks_local_png_size_and_scene_independence(self):
        # A generated image exercises manifest validation only.
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "sample.png"
            Image.new("RGB", (48, 32)).save(path)
            sample = {
                "file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "source": "native-game", "profile": "test", "scene": "negative", "sceneId": "a",
                "gameBuild": "test", "uiScaleSetting": "default", "captureColorPath": "test",
                "prototypeUiScale": 1, "tooltip": False, "cards": [], "sharedVisualIds": [],
            }
            profiles = {"test": {"size": [48, 32]}}
            self.assertEqual(load_samples([sample], profiles, root), [(sample, path.resolve())])
            with self.assertRaisesRegex(ValueError, "PNG format or image size"):
                load_samples([sample], {"test": {"size": [48, 33]}}, root)
            with self.assertRaisesRegex(ValueError, "repeated scene ID"):
                load_samples([sample, sample], profiles, root)

    def test_counts_misgrouped_cards_missing_labels_and_abstentions_separately(self):
        left, right, bottom = [10, 10, 20, 10], [40, 10, 20, 10], [10, 80, 20, 10]
        sample = {
            "scene": "offer", "sharedVisualIds": None,
            "cards": [
                {"group": "offered", "headerBox": left, "name": "Dryad", "visualIds": ["gold-grid"]},
                {"group": "offered", "headerBox": right, "name": "Tempest", "visualIds": []},
                {"group": "collected", "headerBox": bottom, "name": None, "visualIds": None},
            ],
        }
        result = {
            "mode": "offer", "offered": [], "invoked": [],
            "collected": [{"headerBox": left, "name": "Dryad", "rewardSymbols": []}],
            "unassignedCards": [{"headerBox": bottom, "name": None, "rewardSymbols": []}],
            "sharedRewardSymbols": [{"status": "candidate", "visualId": "gold-grid"}],
            "unassignedSymbols": [],
        }
        counts = measure(sample, result)
        for key in ("wrongGroups", "groupAbstentions", "missingCards", "missingSymbols",
                    "correctNames", "unknownNameAbstentions", "acceptedWhereUnattributable"):
            self.assertEqual(counts[key], 1, key)
        self.assertEqual(counts["offeredExpected"], 2)
        self.assertEqual(counts["offeredCorrect"], 0)
        self.assertEqual(counts["collectedCorrect"], 0)


if __name__ == "__main__":
    unittest.main()
