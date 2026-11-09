import copy
import importlib.util
import json
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("unwasm_compat", Path(__file__).with_name("package-unwasm-compat.py"))
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class UnwasmCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())
        cls.original = (COMPAT.SOURCE / "upstream/unwasm-0.6.3.tgz").read_bytes()

    def test_reproducible_archive_preserves_original_api_types_licenses_and_unmodified_files(self):
        output = COMPAT.build_archive(self.original, self.record)
        self.assertEqual(output, COMPAT.build_archive(self.original, self.record))
        self.assertEqual(output, COMPAT.TARGET.read_bytes())
        before = COMPAT.INPUTS.archive_files(self.original)
        after = COMPAT.INPUTS.archive_files(output)
        self.assertEqual(set(after), set(before) | {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"})
        for name, data in before.items():
            if name not in {"package/package.json", "package/dist/plugin/index.mjs"}:
                self.assertEqual(after[name], data, name)
        prior = json.loads(before["package/package.json"])
        current = json.loads(after["package/package.json"])
        for name in ["exports", "license", "dependencies", "sideEffects", "type"]:
            self.assertEqual(current[name], prior[name], name)
        self.assertEqual(after["package/UPSTREAM-PACKAGE.json"], before["package/package.json"])

    def test_corrupt_inputs_and_changed_anchor_require_review(self):
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            COMPAT.build_archive(self.original + b"changed", self.record)
        files = COMPAT.INPUTS.archive_files(self.original)
        files["package/dist/plugin/index.mjs"] = files["package/dist/plugin/index.mjs"].replace(b"const resolved = this.resolve(id, importer);", b"const resolved = this.resolveChanged(id, importer);")
        changed = COMPAT.pack_files(files)
        record = copy.deepcopy(self.record)
        record["packages"]["unwasm"]["integrity"] = COMPAT.INPUTS.integrity(changed)
        with self.assertRaisesRegex(ValueError, "anchor"):
            COMPAT.build_archive(changed, record)

    def test_changed_private_identity_and_reserved_members_are_rejected(self):
        record = copy.deepcopy(self.record)
        record["wasmBridge"]["version"] = "changed"
        with self.assertRaisesRegex(ValueError, "maintained identity"):
            COMPAT.build_archive(self.original, record)
        files = COMPAT.INPUTS.archive_files(self.original)
        files["package/UPSTREAM-PACKAGE.json"] = b"changed"
        changed = COMPAT.pack_files(files)
        record = copy.deepcopy(self.record)
        record["packages"]["unwasm"]["integrity"] = COMPAT.INPUTS.integrity(changed)
        with self.assertRaisesRegex(ValueError, "Reserved"):
            COMPAT.build_archive(changed, record)


if __name__ == "__main__":
    unittest.main()
