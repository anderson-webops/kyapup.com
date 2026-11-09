import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("package-unhead-compat.py")
SPEC = importlib.util.spec_from_file_location("unhead_compat", SCRIPT)
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class UnheadCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.upstream = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())
        self.original = (COMPAT.SOURCE / self.upstream["archive"]).read_bytes()

    def test_reproducible_archive_preserves_all_original_modules_types_ui_and_license(self):
        first = COMPAT.build_archive(self.original, self.upstream)
        self.assertEqual(first, COMPAT.build_archive(self.original, self.upstream))
        original = COMPAT.archive_files(self.original)
        packaged = COMPAT.archive_files(first)
        self.assertEqual(set(packaged), set(original) | {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"})
        for name, data in original.items():
            if name != "package/package.json":
                self.assertEqual(packaged[name], data, name)
        self.assertEqual(packaged["package/UPSTREAM-PACKAGE.json"], original["package/package.json"])
        patched = json.loads(packaged["package/package.json"])
        metadata = json.loads(original["package/package.json"])
        patched["version"] = metadata["version"]
        self.assertTrue(patched.pop("private"))
        self.assertEqual(patched["peerDependencies"]["@vitejs/devtools-kit"], "^0.8.2")
        patched["peerDependencies"]["@vitejs/devtools-kit"] = metadata["peerDependencies"]["@vitejs/devtools-kit"]
        self.assertEqual(patched, metadata)

    def test_corrupt_upstream_is_rejected_before_reading_members(self):
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            COMPAT.build_archive(self.original + b"tampered", self.upstream)

    def test_actual_installed_bundler_preserves_the_complete_qualified_archive(self):
        expected = COMPAT.archive_files(COMPAT.build_archive(self.original, self.upstream))
        lock = json.loads((COMPAT.ROOT / "package-lock.json").read_text())
        consumers = [name for name in lock["packages"] if name.endswith("/@unhead/bundler")]
        self.assertTrue(consumers)
        for consumer in consumers:
            directory = COMPAT.ROOT / consumer
            actual = {"package/" + str(filename.relative_to(directory)): filename.read_bytes() for filename in directory.rglob("*") if filename.is_file() and "node_modules" not in filename.relative_to(directory).parts}
            self.assertEqual(actual.keys(), expected.keys())
            for name, data in expected.items():
                self.assertEqual(actual[name], data, name)

    def test_changed_original_peer_identity_or_unreviewed_new_peer_is_rejected(self):
        original = COMPAT.archive_files(self.original)["package/package.json"]
        for key, value in [("name", "another-package"), ("version", "3.4.4"), ("license", "another-license")]:
            metadata = json.loads(original)
            metadata[key] = value
            with self.assertRaises(ValueError):
                COMPAT.patched_metadata(json.dumps(metadata).encode(), self.upstream)
        changed = {**self.upstream, "kitRange": "*"}
        with self.assertRaises(ValueError):
            COMPAT.patched_metadata(original, changed)
        metadata = json.loads(original)
        metadata["peerDependencies"]["@vitejs/devtools-kit"] = "*"
        with self.assertRaises(ValueError):
            COMPAT.patched_metadata(json.dumps(metadata).encode(), self.upstream)

    def test_links_traversal_and_duplicate_members_are_rejected(self):
        for name, kind, duplicate in [("package/../../outside", tarfile.REGTYPE, False), ("package//alias", tarfile.REGTYPE, False), ("package", tarfile.REGTYPE, False), ("package/link", tarfile.SYMTYPE, False), ("package/repeated", tarfile.REGTYPE, True)]:
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w:gz") as archive:
                for _index in range(2 if duplicate else 1):
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    archive.addfile(member, io.BytesIO(b""))
            with self.assertRaises(ValueError):
                COMPAT.archive_files(output.getvalue())


if __name__ == "__main__":
    unittest.main()
