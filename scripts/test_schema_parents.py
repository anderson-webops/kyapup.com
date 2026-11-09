import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("schema_parents", ROOT / "scripts/package-schema-parents.py")
PRODUCER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCER)
RECORDS = json.loads((PRODUCER.SOURCE / "UPSTREAM.json").read_text())


class SchemaParentTests(unittest.TestCase):
    def originals(self):
        for name, record in RECORDS.items():
            yield name, (PRODUCER.SOURCE / record["archive"]).read_bytes(), record

    def changed_record(self, record, files, modes):
        payload = PRODUCER.ARCHIVE.pack_files(files, modes)
        changed = copy.deepcopy(record)
        changed["registryIntegrity"] = PRODUCER.IO.integrity(payload)
        changed["registryArchiveSha256"] = hashlib.sha256(payload).hexdigest()
        changed["files"] = {
            name.removeprefix("package/"): {"sha256": hashlib.sha256(contents).hexdigest(), "mode": modes[name]}
            for name, contents in files.items()
        }
        return payload, changed

    def test_complete_inventory_modes_licenses_and_reproducible_source(self):
        for name, payload, record in self.originals():
            with self.subTest(name=name):
                original, modes = PRODUCER.ARCHIVE.archive_files(payload)
                result = PRODUCER.build_archive(payload, record)
                self.assertEqual(result, PRODUCER.build_archive(payload, record))
                maintained, maintained_modes = PRODUCER.ARCHIVE.archive_files(result)
                policy = PRODUCER.PACKAGES[name]
                compiled = {filename.replace("lib/", "dist/", 1).removesuffix(".ts") + suffix for filename in policy.get("compiledSources", []) for suffix in [".js", ".js.map"]}
                self.assertEqual(set(maintained), set(original) | {"package/UPSTREAM-PACKAGE.json", "package/WEBOPS-SCHEMA.json"})
                for filename, contents in original.items():
                    self.assertEqual(maintained_modes[filename], modes[filename], filename)
                    if filename == "package/package.json" or filename.removeprefix("package/") in compiled:
                        continue
                    expected = contents
                    for change in policy.get("replacements", []):
                        if filename == "package/" + change["file"]:
                            expected = expected.replace(change["before"].encode(), change["after"].encode())
                    self.assertEqual(maintained[filename], expected, filename)
                for filename in policy.get("compiledSources", []):
                    target = "package/" + filename.replace("lib/", "dist/", 1).removesuffix(".ts") + ".js"
                    self.assertNotEqual(maintained[target], original[target])
                    source_map = json.loads(maintained[target + ".map"])
                    self.assertEqual(source_map["sourcesContent"], [maintained["package/" + filename].decode()])
                    self.assertTrue(source_map["mappings"])
                self.assertEqual(maintained["package/UPSTREAM-PACKAGE.json"], original["package/package.json"])
                self.assertEqual(json.loads(maintained["package/WEBOPS-SCHEMA.json"]), record)
                expected = copy.deepcopy(record["package"])
                expected.update(version=record["patchedVersion"], private=True)
                expected["dependencies"].update(policy["after"])
                if "qualifiedNode" in policy:
                    expected["engines"]["node"] = policy["qualifiedNode"]
                self.assertEqual(json.loads(maintained["package/package.json"]), expected)

    def test_changed_identity_inventory_digest_modes_or_contract_fail_closed(self):
        for name, payload, record in self.originals():
            for field, value in [("archive", "../../outside.tgz"), ("patchedVersion", "99.0.0"), ("schemaVersion", 3), ("registryArchiveSha256", "0" * 64)]:
                changed = copy.deepcopy(record)
                changed[field] = value
                with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                    PRODUCER.build_archive(payload, changed)
            for field, value in [("sha256", "0" * 64), ("mode", 0o600)]:
                changed = copy.deepcopy(record)
                changed["files"][next(iter(changed["files"]))][field] = value
                with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                    PRODUCER.build_archive(payload, changed)
            with self.assertRaises(ValueError):
                PRODUCER.build_archive(payload + b"changed", record)

    def test_required_sources_types_and_license_independent_of_supplied_inventory(self):
        for name, payload, record in self.originals():
            for required in PRODUCER.PACKAGES[name]["required"]:
                files, modes = PRODUCER.ARCHIVE.archive_files(payload)
                filename = "package/" + required
                files["package/unreviewed-replacement"] = files.pop(filename)
                modes["package/unreviewed-replacement"] = modes.pop(filename)
                changed_payload, changed = self.changed_record(record, files, modes)
                with self.subTest(name=name, filename=filename), self.assertRaisesRegex(ValueError, "Required source"):
                    PRODUCER.build_archive(changed_payload, changed)

    def test_cli_mode_and_source_replacement_contract_are_independently_required(self):
        for name, payload, record in self.originals():
            files, modes = PRODUCER.ARCHIVE.archive_files(payload)
            for command in record["package"].get("bin", {}).values():
                filename = "package/" + command.removeprefix("./")
                modes[filename] = 0o644
                changed_payload, changed = self.changed_record(record, files, modes)
                with self.assertRaisesRegex(ValueError, "CLI must retain executable"):
                    PRODUCER.build_archive(changed_payload, changed)
                modes[filename] = 0o755
            for change in PRODUCER.PACKAGES[name].get("replacements", []):
                files, modes = PRODUCER.ARCHIVE.archive_files(payload)
                filename = "package/" + change["file"]
                files[filename] = files[filename].replace(change["before"].encode(), b"unreviewed source")
                changed_payload, changed = self.changed_record(record, files, modes)
                with self.subTest(name=name, filename=filename), self.assertRaisesRegex(ValueError, "replacement no longer matches"):
                    PRODUCER.build_archive(changed_payload, changed)

    def test_cli_rejects_original_path_before_reading_an_archive(self):
        records = copy.deepcopy(RECORDS)
        records["ajv"]["archive"] = "../../outside.tgz"
        reads = []

        def read(filename, maximum):
            reads.append(filename)
            self.assertEqual(filename, PRODUCER.SOURCE / "UPSTREAM.json")
            return json.dumps(records).encode()

        with patch.object(PRODUCER.IO, "regular_bytes", side_effect=read), patch("sys.argv", ["package-schema-parents.py"]):
            with self.assertRaises(ValueError):
                PRODUCER.main()
        self.assertEqual(reads, [PRODUCER.SOURCE / "UPSTREAM.json"])


if __name__ == "__main__":
    unittest.main()
