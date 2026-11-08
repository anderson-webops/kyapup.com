import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("vue_compiler_compat", Path(__file__).with_name("package-vue-compiler-compat.py"))
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class VueCompilerCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.upstream = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())

    def build(self, name):
        info = self.upstream["packages"][name]
        original = (COMPAT.SOURCE / info["archive"]).read_bytes()
        return original, COMPAT.build_archive(original, name, self.upstream, COMPAT.rebuild_browser)

    def test_both_archives_reproduce_with_original_entrypoints_types_and_licenses(self):
        for name in self.upstream["packages"]:
            original, archive = self.build(name)
            self.assertEqual(archive, COMPAT.build_archive(original, name, self.upstream, COMPAT.rebuild_browser))
            before, after = COMPAT.archive_files(original), COMPAT.archive_files(archive)
            additions = {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json", "package/WEBOPS-THIRD-PARTY-LICENSES.json"}
            if name == "@vue/compiler-core":
                additions.add("package/dist/webops-compiler-tools.cjs")
            self.assertEqual(set(after), set(before) | additions)
            for filename, data in before.items():
                if filename.endswith(".d.ts") or filename in {"package/LICENSE", "package/README.md", "package/index.js"}:
                    self.assertEqual(after[filename], data, filename)
            metadata = json.loads(after["package/package.json"])
            self.assertEqual(metadata.get("exports"), json.loads(before["package/package.json"]).get("exports"))
            self.assertEqual(after["package/UPSTREAM-PACKAGE.json"], before["package/package.json"])
            licenses = json.loads(after["package/WEBOPS-THIRD-PARTY-LICENSES.json"])
            self.assertIn("estree-walker@3.0.3", licenses)
            if name == "@vue/compiler-sfc":
                self.assertIn("@babel/parser@8.1.0", licenses)
                self.assertIn("magic-string@1.4.5", licenses)

    def test_installed_payloads_equal_every_qualified_archive_byte(self):
        lock = json.loads((COMPAT.ROOT / "package-lock.json").read_text())["packages"]
        for name in self.upstream["packages"]:
            _original, archive = self.build(name)
            expected = COMPAT.archive_files(archive)
            consumers = [key for key in lock if key.endswith("/" + name)]
            self.assertTrue(consumers)
            for consumer in consumers:
                directory = COMPAT.ROOT / consumer
                actual = {}
                for filename in directory.rglob("*"):
                    if "node_modules" in filename.relative_to(directory).parts:
                        continue
                    self.assertFalse(filename.is_symlink())
                    if filename.is_file():
                        actual["package/" + str(filename.relative_to(directory))] = filename.read_bytes()
                self.assertEqual(actual, expected)

    def test_embedded_old_implementations_are_removed_before_standalone_rebuilding(self):
        info = self.upstream["packages"]["@vue/compiler-sfc"]
        original = COMPAT.archive_files((COMPAT.SOURCE / info["archive"]).read_bytes())
        entry = COMPAT.browser_entry(original["package/dist/compiler-sfc.esm-browser.js"].decode())
        for old in ["function requireLib ()", "class WalkerBase {", '// src/vlq.ts\nvar comma = ",".charCodeAt(0);', "class MagicString {", "node.typeParameter.constraint"]:
            self.assertNotIn(old, entry)
        for modern in ['from "@babel/parser"', 'from "estree-walker"', 'from "magic-string"', 'case "TSInterfaceHeritage"', "node.body.members"]:
            self.assertIn(modern, entry)

    def test_corrupt_archive_and_changed_toolchain_profile_require_review(self):
        for name, info in self.upstream["packages"].items():
            original = (COMPAT.SOURCE / info["archive"]).read_bytes()
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                COMPAT.build_archive(original + b"tampered", name, self.upstream, COMPAT.rebuild_browser)
            changed = {**self.upstream, "browserTools": {**COMPAT.BROWSER_TOOLS, "estree-walker": "*"}}
            with self.assertRaisesRegex(ValueError, "changed browser tooling profile"):
                COMPAT.build_archive(original, name, changed, COMPAT.rebuild_browser)

    def test_changed_generic_resolver_or_embedded_boundaries_fail_closed(self):
        info = self.upstream["packages"]["@vue/compiler-sfc"]
        original = COMPAT.archive_files((COMPAT.SOURCE / info["archive"]).read_bytes())
        for replacement in ["node.argumentsType", "node.oldTypeParameters"]:
            with self.assertRaisesRegex(ValueError, "generic argument callers"):
                COMPAT.modernize_sfc(original["package/dist/compiler-sfc.cjs.js"].decode().replace("node.typeParameters", replacement, 1))
        with self.assertRaisesRegex(ValueError, "embedded dependency boundaries"):
            COMPAT.browser_entry(original["package/dist/compiler-sfc.esm-browser.js"].decode().replace("var lib = {};", "var changedLib = {};"))

    def test_links_traversal_aliases_and_duplicate_members_are_rejected(self):
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
