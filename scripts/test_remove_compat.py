import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("remove_compat", Path(__file__).with_name("package-remove-compat.py"))
COMPAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPAT)


class RemovalCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.upstream = json.loads((COMPAT.SOURCE / "UPSTREAM.json").read_text())
        self.original = (COMPAT.SOURCE / self.upstream["archive"]).read_bytes()
        self.source = (COMPAT.SOURCE / "index.js").read_bytes()

    def test_archive_reproduces_and_removes_bundled_legacy_compiler(self):
        archive = COMPAT.build_archive(self.original, self.upstream, self.source)
        self.assertEqual(archive, COMPAT.build_archive(self.original, self.upstream, self.source))
        original = COMPAT.archive_files(self.original)
        patched = COMPAT.archive_files(archive)
        chunks = {name for name in original if name.startswith("package/dist/chunk-") and name.endswith(".js")}
        self.assertEqual(len(chunks), 1)
        self.assertEqual(set(patched), (set(original) - chunks) | {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"})
        for name, data in original.items():
            if name in {f"package/dist/{adapter}.{suffix}" for adapter in COMPAT.ADAPTERS for suffix in ("d.ts", "d.cts")}:
                adapter = name.split("/")[-1].split(".")[0]
                self.assertEqual(patched[name], COMPAT.adapter_declaration(adapter))
                continue
            if name.endswith((".d.ts", ".d.cts")) or name in {"package/LICENSE", "package/README.md", "package/dist/types.js", "package/dist/types.cjs"}:
                self.assertEqual(patched[name], data, name)
        self.assertEqual(patched["package/dist/index.js"], self.source)
        self.assertEqual(patched["package/UPSTREAM-PACKAGE.json"], original["package/package.json"])
        self.assertFalse(any(b"@babel+types@7.25.2" in data for name, data in patched.items() if name.endswith((".js", ".cjs"))))
        self.assertLess(sum(map(len, patched.values())), sum(map(len, original.values())) // 10)
        metadata = json.loads(patched["package/package.json"])
        self.assertEqual(metadata["dependencies"], COMPAT.DEPENDENCIES)
        self.assertEqual(metadata["exports"], json.loads(original["package/package.json"])["exports"])

    def test_all_installed_payload_bytes_match_the_qualified_distribution(self):
        expected = COMPAT.archive_files(COMPAT.build_archive(self.original, self.upstream, self.source))
        lock = json.loads((COMPAT.ROOT / "package-lock.json").read_text())
        consumers = [name for name in lock["packages"] if name.endswith("/unplugin-remove")]
        self.assertTrue(consumers)
        for name in consumers:
            directory = COMPAT.ROOT / name
            actual = {"package/" + str(filename.relative_to(directory)): filename.read_bytes() for filename in directory.rglob("*") if filename.is_file() and "node_modules" not in filename.relative_to(directory).parts}
            self.assertEqual(actual, expected)

    def test_corrupt_input_and_unreviewed_compiler_contract_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            COMPAT.build_archive(self.original + b"tampered", self.upstream, self.source)
        upstream = {**self.upstream, "dependencies": {**COMPAT.DEPENDENCIES, "unplugin": "*"}}
        with self.assertRaisesRegex(ValueError, "qualified compiler contract"):
            COMPAT.build_archive(self.original, upstream, self.source)

    def test_changed_bundled_compiler_identity_requires_fresh_review(self):
        files = COMPAT.archive_files(self.original)
        name = next(name for name in files if name.startswith("package/dist/chunk-") and name.endswith(".js"))
        files[name] = files[name].replace(b"@babel+types@7.25.2", b"@babel+types@7.25.3")
        changed = COMPAT.pack_files(files)
        upstream = {**self.upstream, "integrity": COMPAT.integrity(changed)}
        with self.assertRaisesRegex(ValueError, "bundled compiler payload"):
            COMPAT.build_archive(changed, upstream, self.source)

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
