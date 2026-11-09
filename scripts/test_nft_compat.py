import copy
import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("nft_compat", Path(__file__).with_name("package-nft-compat.py"))
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class FileTracerCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())
        cls.original = (COMPAT.SOURCE / "upstream/vercel-nft-1.11.1.tgz").read_bytes()

    def test_reproducible_archive_preserves_modules_types_cli_and_license(self):
        output = COMPAT.build_archive(self.original, self.record)
        self.assertEqual(output, COMPAT.build_archive(self.original, self.record))
        self.assertEqual(output, COMPAT.TARGET.read_bytes())
        before = COMPAT.archive_files(self.original)
        after = COMPAT.archive_files(output)
        self.assertEqual(set(after), set(before) | {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"})
        for name, data in before.items():
            if name not in {"package/package.json", "package/out/analyze.js", "package/out/utils/wrappers.js"}:
                self.assertEqual(after[name], data, name)
        prior = json.loads(before["package/package.json"])
        current = json.loads(after["package/package.json"])
        for name in set(prior) - {"version", "private", "dependencies"}:
            self.assertEqual(current[name], prior[name], name)
        self.assertEqual(current["dependencies"], {**prior["dependencies"], "estree-walker": "3.0.3", "@rollup/pluginutils": "5.5.1-webops.1"})
        self.assertEqual(after["package/UPSTREAM-PACKAGE.json"], before["package/package.json"])
        with tarfile.open(fileobj=io.BytesIO(output), mode="r:gz") as archive:
            self.assertEqual(archive.getmember("package/out/cli.js").mode, 0o755)

    def test_changed_integrity_identity_and_integration_anchor_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            COMPAT.build_archive(self.original + b"changed", self.record)
        record = copy.deepcopy(self.record)
        record["patchedVersion"] = "changed"
        with self.assertRaisesRegex(ValueError, "identity"):
            COMPAT.build_archive(self.original, record)
        files = COMPAT.archive_files(self.original)
        files["package/out/analyze.js"] = files["package/out/analyze.js"].replace(b"estree_walker_1.asyncWalk", b"other.asyncWalk")
        changed = COMPAT.pack_files(files)
        record = copy.deepcopy(self.record)
        record["integrity"] = COMPAT.integrity(changed)
        with self.assertRaisesRegex(ValueError, "anchor"):
            COMPAT.build_archive(changed, record)

    def test_unsafe_archive_paths_links_duplicates_and_bounds_are_rejected(self):
        for name, kind in [("package/../escape", tarfile.REGTYPE), ("package/out/linked", tarfile.SYMTYPE), ("/absolute", tarfile.REGTYPE)]:
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
                member = tarfile.TarInfo(name)
                member.type = kind
                archive.addfile(member, io.BytesIO())
            with self.assertRaises(ValueError):
                COMPAT.archive_files(buffer.getvalue())
        with self.assertRaisesRegex(ValueError, "bound"):
            COMPAT.archive_files(b"a" * (4 * 1024 * 1024 + 1))
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            for _ in range(2):
                archive.addfile(tarfile.TarInfo("package/repeated"), io.BytesIO())
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            COMPAT.archive_files(buffer.getvalue())

    def test_reserved_provenance_members_are_preserved_against_collision(self):
        files = COMPAT.archive_files(self.original)
        files["package/WEBOPS-COMPAT.json"] = b"changed"
        changed = COMPAT.pack_files(files)
        record = copy.deepcopy(self.record)
        record["integrity"] = COMPAT.integrity(changed)
        with self.assertRaisesRegex(ValueError, "Reserved"):
            COMPAT.build_archive(changed, record)


if __name__ == "__main__":
    unittest.main()
