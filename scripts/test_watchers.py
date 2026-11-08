import copy
import importlib.util
import json
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("watcher_inputs", Path(__file__).with_name("check-watcher-inputs.py"))
INPUTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INPUTS)


class WatcherInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((INPUTS.SOURCE / "UPSTREAM.json").read_text())

    def test_all_original_bytes_and_consuming_locks_match(self):
        for info in self.record["packages"]:
            INPUTS.verify_package(info)
        INPUTS.verify_package({**self.record["jiti"], "installed": "vendor/watchers/upstream/node_modules/jiti", "lock": "vendor/watchers/upstream/package-lock.json"})

    def test_integrity_and_archive_path_changes_are_rejected(self):
        for field, value in [("archive", "../other.tgz"), ("integrity", "changed")]:
            info = copy.deepcopy(self.record["packages"][0])
            info[field] = value
            with self.assertRaises(ValueError):
                INPUTS.verify_package(info)

    def test_installed_path_and_lock_changes_require_review(self):
        for field in ["installed", "lock"]:
            info = copy.deepcopy(self.record["packages"][0])
            info[field] = "../other"
            with self.assertRaises(ValueError):
                INPUTS.verify_package(info)


if __name__ == "__main__":
    unittest.main()
