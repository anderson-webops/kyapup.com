import copy
import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("rollup_compat", Path(__file__).with_name("package-rollup-compat.py"))
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class RollupCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())
        cls.bundle = COMPAT.rebuild_tools()

    def original(self, name):
        return (COMPAT.SOURCE / "upstream" / self.record["packages"][name]["archive"]).read_bytes()

    def build(self, name):
        return COMPAT.build_archive(self.original(name), name, self.record, self.bundle)

    def test_reproducible_packages_preserve_original_api_types_licenses_and_unmodified_files(self):
        for name, info in self.record["packages"].items():
            original = COMPAT.archive_files(self.original(name), COMPAT.ALIASES.get(name))
            output = self.build(name)
            self.assertEqual(output, self.build(name))
            filename = COMPAT.ROOT / "vendor" / ("rollup-" + name.split("/")[1] + "-" + info["patchedVersion"] + ".tgz")
            self.assertEqual(filename.read_bytes(), output)
            files = COMPAT.archive_files(output)
            self.assertEqual(original["package/package.json"], files["package/UPSTREAM-PACKAGE.json"])
            for key, data in original.items():
                if key not in {"package/package.json", "package/dist/cjs/index.js", "package/dist/es/index.js"}:
                    self.assertEqual(files[key], data, name + ": " + key)
            self.assertEqual(files["package/types/index.d.mts"], original["package/types/index.d.ts"])
            self.assertIn("package/LICENSE", files)
            metadata = json.loads(files["package/package.json"])
            prior = json.loads(original["package/package.json"])
            for key in ["main", "module", "types", "license", "peerDependencies", "peerDependenciesMeta"]:
                self.assertEqual(metadata.get(key), prior.get(key), name + ": " + key)

    def test_tools_reproduce_and_keep_every_new_embedded_license_or_published_notice(self):
        self.assertEqual(self.bundle, COMPAT.rebuild_tools())
        notices = self.bundle["licenses"]
        for name in ["estree-walker@3.0.3", "magic-string@1.4.5", "@jridgewell/sourcemap-codec@1.6.0", "is-reference@3.0.3"]:
            self.assertIn(name, notices)
        reference = notices["is-reference@3.0.3"]
        package = COMPAT.SOURCE / "tools/node_modules/is-reference"
        self.assertEqual(reference["manifest"], json.loads((package / "package.json").read_text()))
        self.assertEqual(reference["publishedNotice"], (package / "README.md").read_text())

    def test_integrity_metadata_and_changed_integration_anchors_require_review(self):
        for name in self.record["packages"]:
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                COMPAT.build_archive(self.original(name) + b"changed", name, self.record, self.bundle)
        changed = copy.deepcopy(self.record)
        changed["tools"]["magic-string"] = "0.30.21"
        with self.assertRaisesRegex(ValueError, "tool profile"):
            COMPAT.build_archive(self.original("@rollup/pluginutils"), "@rollup/pluginutils", changed, self.bundle)
        name = "@rollup/plugin-replace"
        files = COMPAT.archive_files(self.original(name))
        files["package/dist/cjs/index.js"] = files["package/dist/cjs/index.js"].replace(b"require('magic-string')", b"require('changed')")
        altered = COMPAT.pack_files(files)
        changed = copy.deepcopy(self.record)
        changed["packages"][name]["integrity"] = COMPAT.integrity(altered)
        with self.assertRaisesRegex(ValueError, "anchor"):
            COMPAT.build_archive(altered, name, changed, self.bundle)

    def test_publisher_aliases_are_exact_integrity_bound_and_never_emitted(self):
        for name, aliases in COMPAT.ALIASES.items():
            original = self.original(name)
            with self.assertRaisesRegex(ValueError, "inside package"):
                COMPAT.archive_files(original)
            files = COMPAT.archive_files(original, aliases)
            self.assertFalse(set(files) & aliases.keys())
            changed = copy.deepcopy(aliases)
            changed["package/./dist/cjs/index.js"]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "canonical bytes"):
                COMPAT.archive_files(original, changed)
            self.assertFalse(set(COMPAT.archive_files(self.build(name))) & aliases.keys())

    def test_duplicate_traversal_alias_link_and_oversized_inputs_remain_rejected(self):
        for names in [["package/duplicate", "package/duplicate"], ["package/../escape"], ["package/./unreviewed"], ["package//alias"], ["package/link"]]:
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w:gz") as archive:
                for name in names:
                    member = tarfile.TarInfo(name)
                    if name.endswith("/link"):
                        member.type = tarfile.SYMTYPE
                        member.linkname = "../../outside"
                        archive.addfile(member)
                    else:
                        archive.addfile(member, io.BytesIO(b""))
            with self.assertRaises(ValueError):
                COMPAT.archive_files(output.getvalue())
        with self.assertRaisesRegex(ValueError, "bound"):
            COMPAT.archive_files(b"x" * (1024 * 1024 + 1))


if __name__ == "__main__":
    unittest.main()
