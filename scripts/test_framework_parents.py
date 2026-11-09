import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("framework_parents", ROOT / "scripts/package-framework-parents.py")
PRODUCER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCER)
RECORDS = json.loads((PRODUCER.SOURCE / "UPSTREAM.json").read_text())


class FrameworkParentTests(unittest.TestCase):
    def originals(self):
        for name, record in RECORDS.items():
            yield name, (PRODUCER.SOURCE / record["archive"]).read_bytes(), record

    def changed_record(self, record, files, modes):
        payload = PRODUCER.pack_files(files, modes)
        changed = copy.deepcopy(record)
        changed["registryIntegrity"] = PRODUCER.IO.integrity(payload)
        changed["registryArchiveSha256"] = hashlib.sha256(payload).hexdigest()
        changed["files"] = {
            name.removeprefix("package/"): {"sha256": hashlib.sha256(contents).hexdigest(), "mode": modes[name]}
            for name, contents in files.items()
        }
        return payload, changed

    def test_complete_source_inventory_and_all_executable_modes_are_preserved(self):
        for name, payload, record in self.originals():
            with self.subTest(name=name):
                original, modes = PRODUCER.archive_files(payload)
                result = PRODUCER.build_archive(payload, record)
                self.assertEqual(result, PRODUCER.build_archive(payload, record))
                maintained, maintained_modes = PRODUCER.archive_files(result)
                for filename, contents in original.items():
                    self.assertEqual(maintained_modes[filename], modes[filename], filename)
                    if filename != "package/package.json":
                        expected_contents = contents
                        for change in PRODUCER.PACKAGES[name].get("replacements", []):
                            if filename == "package/" + change["file"]:
                                expected_contents = expected_contents.replace(change["before"].encode(), change["after"].encode())
                        self.assertEqual(maintained[filename], expected_contents, filename)
                self.assertEqual(maintained["package/UPSTREAM-PACKAGE.json"], original["package/package.json"])
                self.assertEqual(json.loads(maintained["package/WEBOPS-PARENT.json"]), record)
                expected = copy.deepcopy(record["package"])
                policy = PRODUCER.PACKAGES[name]
                expected["version"] = record["patchedVersion"]
                expected["private"] = True
                expected[policy["section"]][policy["provider"]] = policy["after"]
                self.assertEqual(json.loads(maintained["package/package.json"]), expected)

    def test_rejects_changed_archive_or_source_or_modes(self):
        for name, payload, record in self.originals():
            for field in ["sha256", "mode"]:
                with self.subTest(name=name, field=field):
                    changed = copy.deepcopy(record)
                    filename = next(iter(changed["files"]))
                    changed["files"][filename][field] = "0" * 64 if field == "sha256" else 0o600
                    with self.assertRaises(ValueError):
                        PRODUCER.build_archive(payload, changed)
            with self.assertRaises(ValueError):
                PRODUCER.build_archive(payload + b"changed", record)

    def test_rejects_unknown_identity_contract_and_original_path(self):
        for name, payload, record in self.originals():
            for field, value in [("archive", "../../outside.tgz"), ("patchedVersion", "99.0.0"), ("schemaVersion", 3)]:
                with self.subTest(name=name, field=field):
                    changed = copy.deepcopy(record)
                    changed[field] = value
                    with self.assertRaises(ValueError):
                        PRODUCER.build_archive(payload, changed)
            changed = copy.deepcopy(record)
            policy = PRODUCER.PACKAGES[name]
            changed["package"][policy["section"]][policy["provider"]] = "*"
            with self.assertRaises(ValueError):
                PRODUCER.build_archive(payload, changed)

    def test_required_runtime_types_and_license_are_independent_of_inventory(self):
        for name, payload, record in self.originals():
            for relative in PRODUCER.PACKAGES[name]["required"]:
                with self.subTest(name=name, relative=relative):
                    files, modes = PRODUCER.archive_files(payload)
                    filename = "package/" + relative
                    files["package/unreviewed-replacement"] = files.pop(filename)
                    modes["package/unreviewed-replacement"] = modes.pop(filename)
                    changed_payload, changed = self.changed_record(record, files, modes)
                    with self.assertRaisesRegex(ValueError, "Required framework"):
                        PRODUCER.build_archive(changed_payload, changed)

    def test_cli_executable_modes_are_independently_required(self):
        for name, payload, record in self.originals():
            files, modes = PRODUCER.archive_files(payload)
            filename = "package/" + next(iter(record["package"]["bin"].values())).removeprefix("./")
            modes[filename] = 0o644
            changed_payload, changed = self.changed_record(record, files, modes)
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "CLI must retain executable"):
                PRODUCER.build_archive(changed_payload, changed)

    def test_cli_rejects_source_path_before_opening_any_original_archive(self):
        records = copy.deepcopy(RECORDS)
        records[next(iter(records))]["archive"] = "../../outside.tgz"
        reads = []

        def read(filename, maximum):
            reads.append(filename)
            self.assertEqual(filename, PRODUCER.SOURCE / "UPSTREAM.json")
            return json.dumps(records).encode()

        with patch.object(PRODUCER.IO, "regular_bytes", side_effect=read), patch("sys.argv", ["package-framework-parents.py"]):
            with self.assertRaises(ValueError):
                PRODUCER.main()
        self.assertEqual(reads, [PRODUCER.SOURCE / "UPSTREAM.json"])

    def test_exact_source_corrections_reject_rebased_unreviewed_inputs(self):
        for name, payload, record in self.originals():
            for change in PRODUCER.PACKAGES[name].get("replacements", []):
                with self.subTest(name=name, filename=change["file"]):
                    files, modes = PRODUCER.archive_files(payload)
                    filename = "package/" + change["file"]
                    files[filename] = files[filename].replace(change["before"].encode(), b"unreviewed source")
                    changed_payload, changed = self.changed_record(record, files, modes)
                    with self.assertRaisesRegex(ValueError, "source correction no longer matches"):
                        PRODUCER.build_archive(changed_payload, changed)

    def test_installed_bytes_inventory_modes_and_directory_links_are_verified(self):
        files = {"package/package.json": b"{}", "package/dist/entry.js": b"export default 42"}
        modes = {"package/package.json": 0o644, "package/dist/entry.js": 0o755}
        payload = PRODUCER.pack_files(files, modes)
        with tempfile.TemporaryDirectory(dir=ROOT / ".ai-work/runs") as folder:
            directory = Path(folder)
            (directory / "dist").mkdir()
            (directory / "package.json").write_bytes(b"{}")
            entry = directory / "dist/entry.js"
            entry.write_bytes(b"export default 42")
            entry.chmod(0o755)
            PRODUCER.verify_installed(payload, directory)
            entry.write_bytes(b"substituted source")
            with self.assertRaisesRegex(ValueError, "bytes differ"):
                PRODUCER.verify_installed(payload, directory)
            entry.write_bytes(b"export default 42")
            entry.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "executable mode"):
                PRODUCER.verify_installed(payload, directory)
            entry.chmod(0o755)
            extra = directory / "unexpected.js"
            extra.write_bytes(b"unreviewed source")
            with self.assertRaisesRegex(ValueError, "inventory differs"):
                PRODUCER.verify_installed(payload, directory)
            extra.unlink()
            (directory / "dist").rename(directory / "retained")
            (directory / "dist").symlink_to(directory / "retained", target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "must not redirect"):
                PRODUCER.verify_installed(payload, directory)


if __name__ == "__main__":
    unittest.main()
