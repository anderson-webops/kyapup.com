import copy
import importlib.util
import json
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("jiti_compat", Path(__file__).with_name("package-jiti-compat.py"))
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class JitiCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())["jiti"]
        cls.original = (COMPAT.SOURCE / "upstream/jiti-2.7.0.tgz").read_bytes()

    def test_reproducible_loader_preserves_cli_types_exports_and_bundled_content(self):
        output = COMPAT.build_archive(self.original, self.record)
        self.assertEqual(output, COMPAT.build_archive(self.original, self.record))
        self.assertEqual(output, COMPAT.TARGET.read_bytes())
        before = COMPAT.ARCHIVES.archive_files(self.original)
        after = COMPAT.ARCHIVES.archive_files(output)
        self.assertEqual(set(after), set(before) | {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"})
        for name, data in before.items():
            if name not in {"package/package.json", "package/dist/jiti.cjs"}:
                self.assertEqual(after[name], data, name)
        prior = json.loads(before["package/package.json"])
        current = json.loads(after["package/package.json"])
        for name in set(prior) - {"version", "private"}:
            self.assertEqual(current[name], prior[name], name)
        self.assertEqual(after["package/UPSTREAM-PACKAGE.json"], before["package/package.json"])

    def test_changed_input_and_maintained_identity_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            COMPAT.build_archive(self.original + b"changed", self.record)
        record = copy.deepcopy(self.record)
        record["patchedVersion"] = "changed"
        with self.assertRaisesRegex(ValueError, "identity"):
            COMPAT.build_archive(self.original, record)

    def test_every_changed_integration_anchor_requires_fresh_review(self):
        for before, _after in COMPAT.ANCHORS:
            files = COMPAT.ARCHIVES.archive_files(self.original)
            files["package/dist/jiti.cjs"] = files["package/dist/jiti.cjs"].replace(before.encode(), b"changed")
            changed = COMPAT.ARCHIVES.pack_files(files)
            record = copy.deepcopy(self.record)
            record["integrity"] = COMPAT.ARCHIVES.integrity(changed)
            with self.assertRaisesRegex(ValueError, "anchor"):
                COMPAT.build_archive(changed, record)


if __name__ == "__main__":
    unittest.main()
