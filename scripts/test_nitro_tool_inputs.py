import copy
import importlib.util
import io
import json
import tarfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("nitro_tools", Path(__file__).with_name("check-nitro-tool-inputs.py"))
TOOLS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOLS)


class NitroToolInputTests(unittest.TestCase):
    def test_exact_original_distributions_and_consuming_locks_are_preserved(self):
        TOOLS.main()

    def test_changed_identity_or_archive_integrity_is_rejected(self):
        record = json.loads((TOOLS.SOURCE / "UPSTREAM.json").read_text())
        for info in record["packages"].values():
            changed = copy.deepcopy(info)
            changed["integrity"] = "sha512-changed"
            with self.assertRaisesRegex(ValueError, "integrity mismatch"):
                TOOLS.verify_package(changed)
            changed = copy.deepcopy(info)
            changed["archive"] = "../outside.tgz"
            with self.assertRaisesRegex(ValueError, "archive path"):
                TOOLS.verify_package(changed)

    def test_duplicate_traversal_alias_and_link_members_are_rejected(self):
        for names in [["package/duplicate", "package/duplicate"], ["package/../outside"], ["package/./alias"], ["package//alias"], ["package/link"]]:
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w:gz") as archive:
                for name in names:
                    member = tarfile.TarInfo(name)
                    if name.endswith("/link"):
                        member.type = tarfile.SYMTYPE
                        member.linkname = "../../outside"
                        archive.addfile(member)
                    else:
                        archive.addfile(member, io.BytesIO(b""))
            with self.assertRaises(ValueError):
                TOOLS.archive_files(output.getvalue())

    def test_oversized_and_missing_required_inputs_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "bound"):
            TOOLS.archive_files(b"x" * (4 * 1024 * 1024 + 1))
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz"):
            pass
        with self.assertRaisesRegex(ValueError, "metadata or license"):
            TOOLS.archive_files(output.getvalue())


if __name__ == "__main__":
    unittest.main()
