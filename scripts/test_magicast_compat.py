import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("magicast_compat", Path(__file__).with_name("package-magicast-compat.py"))
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class ConfigurationEditorCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.upstream = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())
        self.original = (COMPAT.SOURCE / self.upstream["archive"]).read_bytes()
        self.bridge = (COMPAT.SOURCE / "babel8.js").read_bytes()

    def test_reproducible_archive_preserves_every_unmodified_module_and_declaration(self):
        archive = COMPAT.build_archive(self.original, self.upstream, self.bridge)
        self.assertEqual(archive, COMPAT.build_archive(self.original, self.upstream, self.bridge))
        original = COMPAT.archive_files(self.original)
        patched = COMPAT.archive_files(archive)
        self.assertEqual(set(patched), set(original) | {"package/dist/babel8.js", "package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"})
        for name, data in original.items():
            if name not in {COMPAT.BUNDLE, "package/package.json", "package/dist/helpers.js"}:
                self.assertEqual(patched[name], data, name)
        self.assertEqual(patched["package/UPSTREAM-PACKAGE.json"], original["package/package.json"])
        metadata = json.loads(patched["package/package.json"])
        self.assertEqual(metadata["dependencies"], COMPAT.DEPENDENCIES)
        self.assertEqual(metadata["exports"], json.loads(original["package/package.json"])["exports"])
        self.assertNotIn(b"source-map-js@1.2.1/node_modules", patched[COMPAT.BUNDLE])
        self.assertIn(b'const import_source_map = currentSourceMap;', patched[COMPAT.BUNDLE])
        self.assertEqual(patched["package/dist/babel8.js"], self.bridge)

    def test_all_installed_editor_payloads_match_the_exact_qualified_archive(self):
        expected = COMPAT.archive_files(COMPAT.build_archive(self.original, self.upstream, self.bridge))
        lock = json.loads((COMPAT.ROOT / "package-lock.json").read_text())["packages"]
        consumers = [name for name in lock if name.endswith("/magicast")]
        self.assertTrue(consumers)
        for name in consumers:
            directory = COMPAT.ROOT / name
            actual = {"package/" + str(filename.relative_to(directory)): filename.read_bytes() for filename in directory.rglob("*") if filename.is_file() and "node_modules" not in filename.relative_to(directory).parts}
            self.assertEqual(actual, expected)

    def test_archive_corruption_and_changed_dependency_contract_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            COMPAT.build_archive(self.original + b"tampered", self.upstream, self.bridge)
        changed = {**self.upstream, "dependencies": {**COMPAT.DEPENDENCIES, "@babel/parser": "*"}}
        with self.assertRaisesRegex(ValueError, "qualified compiler contract"):
            COMPAT.build_archive(self.original, changed, self.bridge)

    def test_changed_original_integration_anchor_requires_fresh_review(self):
        files = COMPAT.archive_files(self.original)
        files[COMPAT.BUNDLE] = files[COMPAT.BUNDLE].replace(b"plugins.forEach(fork.use);", b"plugins.map(fork.use);")
        archive = COMPAT.pack_files(files)
        changed = {**self.upstream, "integrity": COMPAT.integrity(archive)}
        with self.assertRaisesRegex(ValueError, "integration anchor"):
            COMPAT.build_archive(archive, changed, self.bridge)

    def test_duplicates_traversal_aliases_and_links_are_rejected(self):
        for name, kind, repeated in [("package/../outside", tarfile.REGTYPE, False), ("package//alias", tarfile.REGTYPE, False), ("package", tarfile.REGTYPE, False), ("package/link", tarfile.SYMTYPE, False), ("package/repeated", tarfile.REGTYPE, True)]:
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w:gz") as archive:
                for _index in range(2 if repeated else 1):
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    archive.addfile(member, io.BytesIO(b""))
            with self.assertRaises(ValueError):
                COMPAT.archive_files(output.getvalue())


if __name__ == "__main__":
    unittest.main()
