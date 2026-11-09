import copy
import importlib.util
import io
import json
import tarfile
import unittest


SPEC = importlib.util.spec_from_file_location("checker_package", __file__.replace("test_checker_compat.py", "package-checker-compat.py"))
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class CheckerPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = json.loads((PACKAGE.SOURCE / "UPSTREAM.json").read_text())
        cls.original = (PACKAGE.SOURCE / cls.upstream["archive"]).read_bytes()
        cls.bridge = (PACKAGE.SOURCE / "babel8.js").read_bytes()
        cls.declarations = (PACKAGE.SOURCE / "babel8.d.ts").read_bytes()

    def build(self):
        return PACKAGE.build_archive(self.original, self.upstream, self.bridge, self.declarations)

    def test_reproducible_archive_preserves_all_unmodified_upstream_modules_and_metadata(self):
        output = self.build()
        self.assertEqual(output, self.build())
        self.assertEqual(output, PACKAGE.TARGET.read_bytes())
        original = PACKAGE.archive_files(self.original)
        files = PACKAGE.archive_files(output)
        changed = {"package/package.json", "package/dist/codeFrame.js", "package/dist/codeFrame.d.ts", "package/dist/logger.d.ts", "package/dist/codeFrame.js.map", "package/dist/logger.js.map"}
        for name, data in original.items():
            if name not in changed:
                self.assertEqual(data, files[name], name)
        self.assertEqual(original["package/package.json"], files["package/UPSTREAM-PACKAGE.json"])
        current = json.loads(files["package/package.json"])
        prior = json.loads(original["package/package.json"])
        for name in ["exports", "main", "types", "license", "peerDependencies", "peerDependenciesMeta"]:
            self.assertEqual(prior[name], current[name], name)
        self.assertEqual(current["dependencies"], {**prior["dependencies"], "@babel/code-frame": "8.0.6"})

    def test_map_inputs_follow_the_boundary_module_without_moving_diagnostic_code(self):
        original = PACKAGE.archive_files(self.original)
        files = PACKAGE.archive_files(self.build())
        for name in ["codeFrame.js.map", "logger.js.map"]:
            old = json.loads(original["package/dist/" + name])
            updated = json.loads(files["package/dist/" + name])
            self.assertEqual(old["mappings"], updated["mappings"])
            self.assertEqual(old["sources"], updated["sources"])
            self.assertEqual(old["sourcesContent"][0].replace("from '@babel/code-frame'", "from './babel8.js'"), updated["sourcesContent"][0])

    def test_original_integrity_and_changed_patch_anchors_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "integrity"):
            PACKAGE.build_archive(self.original + b"changed", self.upstream, self.bridge, self.declarations)
        files = PACKAGE.archive_files(self.original)
        files["package/dist/codeFrame.js"] = files["package/dist/codeFrame.js"].replace(b'from "@babel/code-frame"', b'from "changed-provider"')
        altered = PACKAGE.pack_files(files)
        metadata = {**self.upstream, "integrity": PACKAGE.integrity(altered)}
        with self.assertRaisesRegex(ValueError, "anchor"):
            PACKAGE.build_archive(altered, metadata, self.bridge, self.declarations)

    def test_changed_provider_and_reserved_members_require_review(self):
        metadata = copy.deepcopy(self.upstream)
        metadata["dependencies"]["@babel/code-frame"] = "7.29.7"
        with self.assertRaisesRegex(ValueError, "dependency"):
            PACKAGE.build_archive(self.original, metadata, self.bridge, self.declarations)
        files = PACKAGE.archive_files(self.original)
        files["package/dist/babel8.js"] = b"changed"
        altered = PACKAGE.pack_files(files)
        with self.assertRaisesRegex(ValueError, "Reserved"):
            PACKAGE.build_archive(altered, {**self.upstream, "integrity": PACKAGE.integrity(altered)}, self.bridge, self.declarations)

    def test_duplicate_traversal_alias_and_link_members_are_rejected(self):
        for names in [["package/file", "package/file"], ["package/../escape"], ["package//alias"], ["package/./alias"], ["/absolute"], ["package/link"]]:
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w:gz") as archive:
                for name in names:
                    member = tarfile.TarInfo(name)
                    if name.endswith("/link"):
                        member.type = tarfile.SYMTYPE
                        member.linkname = "../../escape"
                        archive.addfile(member)
                    else:
                        archive.addfile(member, io.BytesIO(b""))
            with self.assertRaises(ValueError):
                PACKAGE.archive_files(output.getvalue())


if __name__ == "__main__":
    unittest.main()
