import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("producer", Path(__file__).with_name("package-vue-devtools.py"))
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)


class VueDevtoolsDistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = json.loads((producer.SOURCE / "UPSTREAM.json").read_text())
        cls.original = (producer.SOURCE / cls.upstream["archive"]).read_bytes()

    def test_reproducible_distribution_preserves_every_original_payload_and_license(self):
        archive = producer.build_archive(self.original, self.upstream)
        self.assertEqual(archive, producer.build_archive(self.original, self.upstream))
        self.assertEqual(archive, producer.TARGET.read_bytes())
        original = producer.archive_files(self.original)
        result = producer.archive_files(archive)
        for name, data in original.items():
            if name != "package/package.json":
                self.assertEqual(result[name], data, name)
        metadata = json.loads(result["package/package.json"])
        expected = json.loads(original["package/package.json"])
        expected["version"] = "9.0.0-rc.3+webops.1"
        expected["private"] = True
        expected["peerDependencies"]["@vitejs/devtools"] = "^0.8.2"
        self.assertEqual(metadata, expected)
        self.assertEqual(result["package/UPSTREAM-PACKAGE.json"], original["package/package.json"])
        self.assertEqual(json.loads(result["package/WEBOPS-COMPAT.json"]), self.upstream)
        self.assertEqual(len(original), 39)
        self.assertEqual(len(result), 41)

    def test_unreviewed_peer_and_distribution_identity_are_rejected(self):
        original = producer.archive_files(self.original)["package/package.json"]
        for field, value in [("hostRange", "^0.9.0"), ("patchedVersion", "9.0.0-rc.4+webops.1"), ("schemaVersion", 3)]:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.upstream)
                changed[field] = value
                with self.assertRaises(ValueError):
                    producer.patched_metadata(original, changed)

    def test_legacy_kit_metadata_cannot_be_relabelled_as_current_host_compatibility(self):
        changed = copy.deepcopy(self.upstream)
        changed["package"]["dependencies"]["@vitejs/devtools-kit"] = "^0.7.6"
        with self.assertRaisesRegex(ValueError, "original kit contract"):
            producer.patched_metadata(json.dumps(changed["package"]).encode(), changed)

    def test_changed_original_archive_or_complete_inventory_is_rejected(self):
        changed = copy.deepcopy(self.upstream)
        changed["files"].pop("LICENSE")
        with self.assertRaisesRegex(ValueError, "file inventory"):
            producer.build_archive(self.original, changed)
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            producer.build_archive(self.original + b"changed", self.upstream)
        changed = copy.deepcopy(self.upstream)
        changed["files"]["dist/index.mjs"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "payload changed"):
            producer.build_archive(self.original, changed)

    def test_required_ui_and_declarations_remain_independent_requirements(self):
        original = producer.archive_files(self.original)
        for name in ["package/client/index.html", "package/dist/index.d.mts", "package/LICENSE"]:
            with self.subTest(name=name):
                changed = dict(original)
                changed.pop(name)
                with self.assertRaisesRegex(ValueError, "Required module"):
                    producer.archive_files(producer.pack_files(changed))

    def test_links_traversal_and_duplicate_members_are_rejected(self):
        for name, kind in [("package/../../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE), ("package/link", tarfile.SYMTYPE), ("package/link", tarfile.LNKTYPE), ("package//file", tarfile.REGTYPE)]:
            with self.subTest(name=name, kind=kind):
                payload = io.BytesIO()
                with tarfile.open(fileobj=payload, mode="w") as archive:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "outside"
                    archive.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    producer.archive_files(gzip.compress(payload.getvalue()))
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode="w") as archive:
            for repeat in range(2):
                archive.addfile(tarfile.TarInfo("package/duplicate"), io.BytesIO())
        with self.assertRaisesRegex(ValueError, "duplicate"):
            producer.archive_files(gzip.compress(payload.getvalue()))

    def test_expansion_is_bounded_before_tar_metadata_parsing(self):
        with patch.object(producer, "MAX_EXPANDED", 256):
            with self.assertRaisesRegex(ValueError, "Expanded archive"):
                producer.archive_files(gzip.compress(b"x" * 257))

    def test_regular_file_inputs_preserve_private_modes_and_reject_links_and_fifos(self):
        base = producer.ROOT / ".ai-work/runs"
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as directory:
            root = Path(directory)
            filename = root / "input"
            filename.write_bytes(self.original)
            filename.chmod(0o600)
            self.assertEqual(producer.regular_bytes(filename, producer.MAX_COMPRESSED), self.original)
            self.assertEqual(filename.stat().st_mode & 0o777, 0o600)
            alias = root / "alias"
            alias.symlink_to(filename)
            with self.assertRaises(OSError):
                producer.regular_bytes(alias, producer.MAX_COMPRESSED)
            fifo = root / "fifo"
            os.mkfifo(fifo)
            with self.assertRaisesRegex(ValueError, "regular file"):
                producer.regular_bytes(fifo, producer.MAX_COMPRESSED)


if __name__ == "__main__":
    unittest.main()
