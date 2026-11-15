import copy
import importlib.util
import io
import json
import os
import shutil
import tarfile
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("local_libraries", ROOT / "scripts/package-local-libraries.py")
LIBRARIES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LIBRARIES)
RECORDS = json.loads((ROOT / "vendor/local-libraries/INPUTS.json").read_text())["packages"]


class LocalLibraryPackaging(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / ".ai-work/runs/local-library-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=scratch)
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        for name, record in RECORDS.items():
            for relative in record["files"]:
                target = self.root / "vendor" / name / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / "vendor" / name / relative, target)

    def distribution(self, name):
        return LIBRARIES.build_archive(self.root, RECORDS[name])

    def install_fixture(self, name):
        record = RECORDS[name]
        archive, files = self.distribution(name)
        location = "node_modules/" + name
        for relative, data in files.items():
            target = self.root / location / relative.removeprefix("package/")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        if name == "listhen":
            (self.root / location / "bin/listhen.mjs").chmod(0o755)
        reference = "file:vendor/" + name + "-" + record["version"] + ".tgz"
        (self.root / "package.json").write_text(json.dumps({"devDependencies": {name: reference}, "overrides": {name: "$" + name}}))
        lock = {"packages": {location: {"version": record["version"], "resolved": reference, "integrity": LIBRARIES.ARCHIVES.integrity(archive)}}}
        (self.root / "package-lock.json").write_text(json.dumps(lock))
        return record, archive, files, lock

    def test_private_umask_preserves_source_and_archive_modes(self):
        for name in RECORDS:
            first, files = self.distribution(name)
            previous = os.umask(0o077)
            try:
                for relative in RECORDS[name]["files"]:
                    (self.root / "vendor" / name / relative).chmod(0o600)
                second, repeated = self.distribution(name)
            finally:
                os.umask(previous)
            self.assertEqual(first, second)
            self.assertEqual(files, repeated)
            with tarfile.open(fileobj=io.BytesIO(first), mode="r:gz") as archive:
                for member in archive:
                    self.assertEqual(member.uid, 0)
                    self.assertEqual(member.gid, 0)
                    self.assertEqual(member.mtime, 0)
                    expected = 0o755 if member.isdir() or member.name == "package/bin/listhen.mjs" else 0o644
                    self.assertEqual(member.mode, expected)
            self.assertEqual((self.root / "vendor" / name / "package.json").stat().st_mode & 0o777, 0o600)

    def test_preserves_original_manifest_and_every_reviewed_source_byte(self):
        for name, record in RECORDS.items():
            archive, files = self.distribution(name)
            self.assertTrue(archive)
            for relative in record["files"]:
                original = (ROOT / "vendor" / name / relative).read_bytes()
                member = "UPSTREAM-PACKAGE.json" if relative == "package.json" else relative
                self.assertEqual(files["package/" + member], original)
            self.assertEqual(json.loads(files["package/package.json"])["version"], record["version"])

    def test_rejects_source_changes_missing_licenses_and_symlinks(self):
        target = self.root / "vendor/braces/LICENSE"
        original = target.read_bytes()
        target.write_bytes(original + b"changed")
        with self.assertRaisesRegex(ValueError, "source mismatch"):
            self.distribution("braces")
        target.unlink()
        with self.assertRaises(FileNotFoundError):
            self.distribution("braces")
        target.symlink_to(ROOT / "vendor/braces/LICENSE")
        with self.assertRaisesRegex(ValueError, "symbolic links"):
            self.distribution("braces")

    def test_rejects_extra_missing_or_escaping_inventory(self):
        for relative in ["../package.json", "node_modules/jiti/package.json"]:
            record = copy.deepcopy(RECORDS["listhen"])
            record["files"][relative] = "0" * 64
            with self.assertRaisesRegex(ValueError, "inventory mismatch"):
                LIBRARIES.build_archive(self.root, record)
        record = copy.deepcopy(RECORDS["deepmerge"])
        del record["files"]["license.txt"]
        with self.assertRaisesRegex(ValueError, "inventory mismatch"):
            LIBRARIES.build_archive(self.root, record)

    def test_installed_bytes_and_lock_integrity_are_both_required(self):
        record, archive, files, lock = self.install_fixture("deepmerge")
        LIBRARIES.verify_consumers(self.root, record, archive, files, True)
        target = self.root / "node_modules/deepmerge/dist/cjs.js"
        target.write_bytes(target.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "Installed library bytes mismatch"):
            LIBRARIES.verify_consumers(self.root, record, archive, files, True)
        lock["packages"]["node_modules/deepmerge"]["integrity"] = "sha512-invalid"
        (self.root / "package-lock.json").write_text(json.dumps(lock))
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            LIBRARIES.verify_consumers(self.root, record, archive, files, False)

    def test_rejects_linked_projects_nested_installs_and_unexecutable_cli(self):
        record, archive, files, lock = self.install_fixture("listhen")
        LIBRARIES.verify_consumers(self.root, record, archive, files, True)
        lock["packages"]["vendor/listhen/node_modules/jiti"] = {"version": "2.7.0"}
        (self.root / "package-lock.json").write_text(json.dumps(lock))
        with self.assertRaisesRegex(ValueError, "linked npm project"):
            LIBRARIES.verify_consumers(self.root, record, archive, files, True)
        del lock["packages"]["vendor/listhen/node_modules/jiti"]
        lock["packages"]["node_modules/listhen"]["link"] = True
        (self.root / "package-lock.json").write_text(json.dumps(lock))
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            LIBRARIES.verify_consumers(self.root, record, archive, files, True)
        del lock["packages"]["node_modules/listhen"]["link"]
        (self.root / "package-lock.json").write_text(json.dumps(lock))
        (self.root / "node_modules/listhen/bin/listhen.mjs").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "executable"):
            LIBRARIES.verify_consumers(self.root, record, archive, files, True)


if __name__ == "__main__":
    unittest.main()
