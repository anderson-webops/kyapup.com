import copy
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("native_providers", ROOT / "scripts/package-native-providers.py")
PRODUCER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCER)
RECORDS = json.loads((PRODUCER.SOURCE / "UPSTREAM.json").read_text())


class NativeProviderPackages(unittest.TestCase):
    def originals(self):
        for name, record in RECORDS.items():
            yield name, (PRODUCER.SOURCE / record["archive"]).read_bytes(), record

    def test_reproducible_complete_original_payload_and_metadata(self):
        for name, payload, record in self.originals():
            with self.subTest(name=name):
                original = PRODUCER.archive_files(payload)
                archive = PRODUCER.build_archive(payload, record)
                self.assertEqual(archive, PRODUCER.build_archive(payload, record))
                maintained = PRODUCER.archive_files(archive)
                self.assertEqual(set(maintained), set(original) | {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"})
                for filename, contents in original.items():
                    if filename != "package/package.json":
                        policy = PRODUCER.PACKAGES[name]
                        changes = [policy["replacement"], *policy.get("additionalReplacements", [])] if "replacement" in policy else []
                        for change in changes:
                            if filename == "package/" + change["file"]:
                                self.assertEqual(contents.count(change["before"].encode()), 1)
                                contents = contents.replace(change["before"].encode(), change["after"].encode())
                        self.assertEqual(maintained[filename], contents, filename)
                self.assertEqual(maintained["package/UPSTREAM-PACKAGE.json"], original["package/package.json"])
                self.assertEqual(json.loads(maintained["package/WEBOPS-COMPAT.json"]), record)
                expected = copy.deepcopy(record["package"])
                expected["version"] = record["patchedVersion"]
                expected["private"] = True
                policy = PRODUCER.PACKAGES[name]
                expected["dependencies"][policy["dependency"]] = policy["qualifiedRange"]
                self.assertEqual(json.loads(maintained["package/package.json"]), expected)

    def test_rejects_changed_identity_provider_and_archive_path(self):
        for name, payload, record in self.originals():
            for field, value in [("qualifiedRange", "*"), ("patchedVersion", "100.0.0"), ("archive", "../../unexpected.tgz"), ("schemaVersion", 100)]:
                with self.subTest(name=name, field=field):
                    changed = copy.deepcopy(record)
                    changed[field] = value
                    with self.assertRaises(ValueError):
                        PRODUCER.build_archive(payload, changed)

    def test_rejects_changed_archive_and_file_digests(self):
        for name, payload, record in self.originals():
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    PRODUCER.build_archive(payload + b"changed", record)
                changed = copy.deepcopy(record)
                changed["files"]["dist/index.mjs"] = "0" * 64
                with self.assertRaises(ValueError):
                    PRODUCER.build_archive(payload, changed)
                changed = copy.deepcopy(record)
                changed["registryArchiveSha256"] = "0" * 64
                with self.assertRaises(ValueError):
                    PRODUCER.build_archive(payload, changed)

    def test_native_family_upgrade_rejects_previous_ranges_and_maintained_identities(self):
        previous = {
            "eslint-plugin-format": ("^0.77.0", "2.0.1-webops.1"),
            "@unocss/transformer-attributify-jsx": ("^0.157.0", "66.12.0-webops.1"),
        }
        for name, payload, record in self.originals():
            if name not in previous:
                continue
            old_range, old_version = previous[name]
            for field, value in [("qualifiedRange", old_range), ("patchedVersion", old_version)]:
                with self.subTest(name=name, field=field):
                    changed = copy.deepcopy(record)
                    changed[field] = value
                    with self.assertRaises(ValueError):
                        PRODUCER.build_archive(payload, changed)

    def test_independent_required_types_workers_and_license(self):
        for name, payload, record in self.originals():
            files = PRODUCER.archive_files(payload)
            for filename in PRODUCER.PACKAGES[name]["required"]:
                with self.subTest(name=name, filename=filename):
                    contents = dict(files)
                    del contents["package/" + filename]
                    replacement = PRODUCER.pack_files(contents)
                    changed = copy.deepcopy(record)
                    del changed["files"][filename]
                    changed["registryIntegrity"] = PRODUCER.integrity(replacement)
                    changed["registryArchiveSha256"] = hashlib.sha256(replacement).hexdigest()
                    with self.assertRaises(ValueError):
                        PRODUCER.build_archive(replacement, changed)

    def test_rejects_complete_inventory_omissions(self):
        for name, payload, record in self.originals():
            with self.subTest(name=name):
                changed = copy.deepcopy(record)
                del changed["files"]["package.json"]
                with self.assertRaises(ValueError):
                    PRODUCER.build_archive(payload, changed)

    def test_cli_validates_source_paths_before_reading_archive_bytes(self):
        records = copy.deepcopy(RECORDS)
        records[next(iter(records))]["archive"] = "../../outside.tgz"
        reads = []

        def read_metadata(filename, maximum):
            reads.append(filename)
            self.assertEqual(filename, PRODUCER.SOURCE / "UPSTREAM.json")
            return json.dumps(records).encode()

        with patch.object(PRODUCER, "regular_bytes", side_effect=read_metadata), patch("sys.argv", ["package-native-providers.py"]):
            with self.assertRaises(ValueError):
                PRODUCER.main()
        self.assertEqual(reads, [PRODUCER.SOURCE / "UPSTREAM.json"])

    def test_rejects_unsafe_members_duplicates_and_links(self):
        for filename, member_type in [("package/../outside", tarfile.REGTYPE), ("/outside", tarfile.REGTYPE), ("package//invalid", tarfile.REGTYPE), ("package/symlink", tarfile.SYMTYPE), ("package/hardlink", tarfile.LNKTYPE), ("package/device", tarfile.CHRTYPE)]:
            with self.subTest(filename=filename):
                output = io.BytesIO()
                with tarfile.open(fileobj=output, mode="w:gz") as archive:
                    member = tarfile.TarInfo(filename)
                    member.type = member_type
                    member.linkname = "../../outside"
                    archive.addfile(member)
                with self.assertRaises(ValueError):
                    PRODUCER.archive_files(output.getvalue())
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            for unused in range(2):
                archive.addfile(tarfile.TarInfo("package/duplicate"))
        with self.assertRaises(ValueError):
            PRODUCER.archive_files(output.getvalue())

    def test_expansion_is_bounded_before_tar_metadata_parsing(self):
        with self.assertRaises(ValueError):
            PRODUCER.archive_files(gzip.compress(b"a" * (PRODUCER.MAX_EXPANDED + 1)))
        with self.assertRaises(ValueError):
            PRODUCER.archive_files(b"a" * (PRODUCER.MAX_COMPRESSED + 1))

    def test_descriptor_reads_and_writes_preserve_private_modes(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".ai-work/runs") as directory:
            root = Path(directory)
            filename = root / "input"
            filename.write_bytes(b"original")
            filename.chmod(0o600)
            self.assertEqual(PRODUCER.regular_bytes(filename, 8), b"original")
            with self.assertRaises(ValueError):
                PRODUCER.regular_bytes(filename, 7)
            PRODUCER.write_regular(filename, b"new")
            self.assertEqual(filename.read_bytes(), b"new")
            self.assertEqual(stat.S_IMODE(filename.stat().st_mode), 0o600)
            symlink = root / "symlink"
            symlink.symlink_to(filename)
            with self.assertRaises(OSError):
                PRODUCER.regular_bytes(symlink, 8)
            with self.assertRaises(OSError):
                PRODUCER.write_regular(symlink, b"replacement")
            hardlink = root / "hardlink"
            os.link(filename, hardlink)
            with self.assertRaises(ValueError):
                PRODUCER.write_regular(hardlink, b"replacement")
            self.assertEqual(filename.read_bytes(), b"new")
            fifo = root / "fifo"
            os.mkfifo(fifo)
            with self.assertRaises(ValueError):
                PRODUCER.regular_bytes(fifo, 8)


if __name__ == "__main__":
    unittest.main()
