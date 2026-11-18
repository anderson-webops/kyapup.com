import copy
import gzip
import hashlib
import importlib.util
import io
import json
import sys
import tarfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("unimport_source", Path(__file__).with_name("check-unimport-source.py"))
SOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SOURCE)
BUILD_SPEC = importlib.util.spec_from_file_location("unimport_build", Path(__file__).with_name("build-unimport-source.py"))
BUILD = importlib.util.module_from_spec(BUILD_SPEC)
BUILD_SPEC.loader.exec_module(BUILD)


def archive_member(name, content=b"content", kind=tarfile.REGTYPE):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        member = tarfile.TarInfo(name)
        member.type = kind
        member.mode = 0o644
        member.size = len(content) if kind == tarfile.REGTYPE else 0
        archive.addfile(member, io.BytesIO(content) if member.size else None)
    return output.getvalue()


class UnimportSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((SOURCE.SOURCE / "UPSTREAM.json").read_text())

    def test_complete_signed_source_and_both_signatures_verify(self):
        files = SOURCE.verify_source()
        self.assertEqual(len(files), 226)
        self.assertIn("test/unplugin.test.ts", files)
        self.assertIn("LICENSE", files)

    def test_changed_identity_requires_independent_review(self):
        for field in ["repository", "tag", "tagObject", "commit", "tree", "signerFingerprint"]:
            record = copy.deepcopy(self.record)
            record[field] = "changed"
            with self.assertRaises(ValueError):
                SOURCE.verify_source(record)

    def test_input_tampering_is_rejected(self):
        for name in ["tag.git", "commit.git", "signer.gpg", "source.tgz"]:
            record = copy.deepcopy(self.record)
            record["inputsSha256"][name] = "0" * 64
            with self.assertRaises(ValueError):
                SOURCE.verify_source(record)

    def test_archive_tampering_is_rejected(self):
        original = (SOURCE.SOURCE / "source.tgz").read_bytes()
        with self.assertRaises(ValueError):
            SOURCE.verify_source(self.record, original[:-1] + bytes([original[-1] ^ 1]))

    def test_changed_and_missing_files_change_the_git_tree(self):
        files = SOURCE.source_files((SOURCE.SOURCE / "source.tgz").read_bytes())
        files["src/index.ts"] += b"\n"
        self.assertNotEqual(SOURCE.git_tree_id(files), SOURCE.TREE)
        del files["src/index.ts"]
        self.assertNotEqual(SOURCE.git_tree_id(files), SOURCE.TREE)

    def test_paths_links_and_executable_members_are_rejected(self):
        for name in ["../escape", "/source/escape", "source/../escape", "source//file", "other/file"]:
            with self.assertRaises(ValueError):
                SOURCE.source_files(archive_member(name))
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE]:
            with self.assertRaises(ValueError):
                SOURCE.source_files(archive_member("source/link", kind=kind))

    def test_bad_signatures_cannot_be_accepted(self):
        tag = SOURCE.git_object_payload((SOURCE.SOURCE / "tag.git").read_bytes(), "tag")
        with patch.object(SOURCE.subprocess, "run", return_value=SOURCE.subprocess.CompletedProcess([], 1, stdout=b"", stderr=b"")):
            with self.assertRaises(ValueError):
                SOURCE.verify_signature(tag, "tag", SOURCE.SOURCE / "signer.gpg")

    def test_another_valid_signer_is_rejected(self):
        tag = SOURCE.git_object_payload((SOURCE.SOURCE / "tag.git").read_bytes(), "tag")
        result = SOURCE.subprocess.CompletedProcess([], 0, stdout=b"[GNUPG:] VALIDSIG OTHER 2026-01-01\n", stderr=b"")
        with patch.object(SOURCE.subprocess, "run", return_value=result):
            with self.assertRaises(ValueError):
                SOURCE.verify_signature(tag, "tag", SOURCE.SOURCE / "signer.gpg")

    def test_source_patch_changes_only_declared_files(self):
        original = SOURCE.source_files((SOURCE.SOURCE / "source.tgz").read_bytes())
        maintained = BUILD.maintained_source(original)
        changed = [name for name in original if original[name] != maintained[name]]
        formatting = json.loads(BUILD.FORMATTING.read_text())
        self.assertEqual(set(changed), {"src/node/extract-package.ts", "src/detect-acorn.ts", "src/presets/vueuse-core.ts", "test/auto-extract.test.ts"} | {entry["path"] for entry in formatting["files"]})
        self.assertIn(b"url ?? pathToFileURL", maintained["src/node/extract-package.ts"])
        self.assertEqual(maintained["src/node/extract-package.ts"].count(b"{ url: moduleUrl }"), 2)
        self.assertIn(b"paths: [import.meta.url]", maintained["src/detect-acorn.ts"])
        self.assertIn(b"Object.keys(h3)", maintained["test/auto-extract.test.ts"])
        self.assertIn(b"expect(result1).toEqual(expected)", maintained["test/auto-extract.test.ts"])

    def test_changed_source_patch_anchors_fail_closed(self):
        original = SOURCE.source_files((SOURCE.SOURCE / "source.tgz").read_bytes())
        original["src/node/extract-package.ts"] += b"\nimport os from 'node:os'\n"
        with self.assertRaises(ValueError):
            BUILD.maintained_source(original)

    def test_formatting_binds_exact_inputs_edits_and_outputs(self):
        entry = {"path": "example.ts", "inputSha256": hashlib.sha256(b"before").hexdigest(), "outputSha256": hashlib.sha256(b"after").hexdigest(), "edits": [[0, 6, "after"]]}
        record = {"schemaVersion": 1, "files": [entry]}
        with patch.object(BUILD.SOURCE, "regular_bytes", return_value=json.dumps(record).encode()):
            self.assertEqual(BUILD.apply_formatting({"example.ts": b"before"}), {"example.ts": b"after"})
            with self.assertRaises(ValueError):
                BUILD.apply_formatting({"example.ts": b"changed"})
        for changed in [{**entry, "edits": [[0, 7, "after"]]}, {**entry, "outputSha256": "0" * 64}, {**entry, "path": "missing.ts"}]:
            with self.subTest(changed=changed), patch.object(BUILD.SOURCE, "regular_bytes", return_value=json.dumps({"schemaVersion": 1, "files": [changed]}).encode()):
                with self.assertRaises(ValueError):
                    BUILD.apply_formatting({"example.ts": b"before"})

    def test_packaging_is_deterministic_and_has_regular_readable_members(self):
        files = {"package/package.json": b"{}", "package/LICENSE": b"license"}
        first = BUILD.pack_files(files)
        self.assertEqual(first, BUILD.pack_files(dict(reversed(list(files.items())))))
        with tarfile.open(fileobj=io.BytesIO(first), mode="r:gz") as archive:
            self.assertTrue(all(member.isfile() and member.mode == 0o644 for member in archive))

    def test_signed_tree_ordering_matches_git_objects(self):
        files = SOURCE.source_files((SOURCE.SOURCE / "source.tgz").read_bytes())
        self.assertEqual(SOURCE.git_tree_id(dict(reversed(list(files.items())))), SOURCE.TREE)

    def test_source_build_preserves_the_original_license_and_package_identity(self):
        original = SOURCE.source_files((SOURCE.SOURCE / "source.tgz").read_bytes())
        with tarfile.open(BUILD.TARGET, mode="r:gz") as archive:
            self.assertEqual(archive.extractfile("package/LICENSE").read(), original["LICENSE"])
            self.assertEqual(archive.extractfile("package/UPSTREAM-PACKAGE.json").read(), original["package.json"])
            metadata = json.load(archive.extractfile("package/package.json"))
            self.assertEqual(metadata["version"], "7.0.3+webops.3")
            self.assertEqual(metadata["dependencies"]["picomatch"], "4.0.7-webops.1")
            self.assertTrue(all(not specification.startswith("file:") for specification in metadata["dependencies"].values()))

    def test_runtime_provider_translation_preserves_the_compiler_graph_and_rejects_drift(self):
        manifest = json.loads((BUILD.BUILD / "package.json").read_text())
        unchanged = copy.deepcopy(manifest)
        dependencies = BUILD.runtime_dependencies(manifest)
        self.assertEqual(manifest, unchanged)
        self.assertEqual(dependencies["picomatch"], "4.0.7-webops.1")
        for name, specification in [("picomatch", "^4.0.7"), ("magic-string", "file:../unexpected")]:
            with self.subTest(name=name):
                changed = copy.deepcopy(manifest)
                changed["dependencies"][name] = specification
                with self.assertRaises(ValueError):
                    BUILD.runtime_dependencies(changed)

    def test_upstream_checks_run_once_when_requested_and_both_builds_always_run(self):
        for arguments, expected in [([], [False, False]), (["--validate-upstream"], [True, False])]:
            with self.subTest(arguments=arguments):
                with patch.object(sys, "argv", ["build-unimport-source.py", "--check", *arguments]), patch.object(BUILD.SOURCE, "verify_source", return_value={}), patch.object(BUILD.SOURCE, "regular_bytes", return_value=b"compiled"), patch.object(BUILD, "build_once", return_value=b"compiled") as build:
                    BUILD.main()
                self.assertEqual([call.args[1] for call in build.call_args_list], expected)

    def test_compressed_git_objects_reject_wrong_headers_and_trailing_data(self):
        data = (SOURCE.SOURCE / "commit.git").read_bytes()
        with self.assertRaises(ValueError):
            SOURCE.git_object_payload(data, "tag")
        with self.assertRaises(ValueError):
            SOURCE.git_object_payload(data + b"trailing", "commit")

    def test_compressed_git_objects_are_bounded(self):
        with self.assertRaises(ValueError):
            SOURCE.git_object_payload(zlib.compress(b"commit 100000\0" + b"x" * 100000), "commit")

    def test_source_expansion_is_bounded_before_tar_metadata_is_read(self):
        with self.assertRaisesRegex(ValueError, "Expanded source archive"):
            SOURCE.source_files(gzip.compress(b"\0" * (8 * 1024 * 1024 + 1), mtime=0))


if __name__ == "__main__":
    unittest.main()
