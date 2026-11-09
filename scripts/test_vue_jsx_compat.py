import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("vue_jsx_compat", Path(__file__).with_name("package-vue-jsx-compat.py"))
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class VueJsxCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.upstream = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())
        self.original = (COMPAT.SOURCE / self.upstream["archive"]).read_bytes()

    def test_reproducible_archive_retains_original_payload_and_exact_api_patch(self):
        archive = COMPAT.build_archive(self.original, self.upstream)
        self.assertEqual(archive, COMPAT.build_archive(self.original, self.upstream))
        original = COMPAT.archive_files(self.original)
        patched = COMPAT.archive_files(archive)
        self.assertEqual(set(patched), set(original) | {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"})
        for name, data in original.items():
            if name not in {"package/package.json", "package/dist/index.mjs"}:
                self.assertEqual(patched[name], data, name)
        expected = original["package/dist/index.mjs"].decode().replace(COMPAT.ORIGINAL_PURE, COMPAT.MODERN_PURE).replace("babel.createConfigItem(", "babel.createConfigItemSync(")
        self.assertEqual(patched["package/dist/index.mjs"], expected.encode())
        self.assertEqual(patched["package/UPSTREAM-PACKAGE.json"], original["package/package.json"])
        metadata = json.loads(patched["package/package.json"])
        self.assertEqual({name: metadata["dependencies"][name] for name in COMPAT.DEPENDENCIES}, COMPAT.DEPENDENCIES)
        metadata["dependencies"].update(COMPAT.ORIGINAL_DEPENDENCIES)
        metadata["version"] = "5.1.6"
        self.assertTrue(metadata.pop("private"))
        metadata["engines"]["node"] = "^20.19.0 || >=22.12.0"
        metadata["peerDependencies"].update(json.loads(original["package/package.json"])["peerDependencies"])
        self.assertEqual(metadata, json.loads(original["package/package.json"]))

    def test_installed_provider_matches_every_qualified_archive_member(self):
        expected = COMPAT.archive_files(COMPAT.build_archive(self.original, self.upstream))
        lock = json.loads((COMPAT.ROOT / "package-lock.json").read_text())
        consumers = [name for name in lock["packages"] if name.endswith("/@vitejs/plugin-vue-jsx")]
        self.assertTrue(consumers)
        for name in consumers:
            directory = COMPAT.ROOT / name
            actual = {"package/" + str(filename.relative_to(directory)): filename.read_bytes() for filename in directory.rglob("*") if filename.is_file() and "node_modules" not in filename.relative_to(directory).parts}
            self.assertEqual(actual, expected)

    def test_corruption_and_unreviewed_dependency_changes_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            COMPAT.build_archive(self.original + b"tampered", self.upstream)
        changed = {**self.upstream, "dependencies": {**COMPAT.DEPENDENCIES, "@babel/core": "*"}}
        with self.assertRaisesRegex(ValueError, "qualified Babel contract"):
            COMPAT.build_archive(self.original, changed)

    def test_changed_transform_anchor_fails_before_producing_a_distribution(self):
        files = COMPAT.archive_files(self.original)
        files["package/dist/index.mjs"] = files["package/dist/index.mjs"].replace(b"babel.createConfigItem(", b"babel.otherConfigItem(")
        changed = COMPAT.pack_files(files)
        upstream = {**self.upstream, "integrity": COMPAT.integrity(changed)}
        with self.assertRaisesRegex(ValueError, "synchronous TypeScript"):
            COMPAT.build_archive(changed, upstream)

    def test_links_aliases_traversal_and_duplicate_members_are_rejected(self):
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
