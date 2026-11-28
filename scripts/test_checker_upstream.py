import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('checker_upstream', Path(__file__).with_name('check-checker-upstream.py'))
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class CurrentCheckerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((CHECKER.SOURCE / 'CURRENT.json').read_text())
        cls.archive = (CHECKER.SOURCE / cls.record['archive']).read_bytes()

    def test_official_source_keeps_its_native_position_types_and_original_modules(self):
        files = CHECKER.current_files(self.archive, self.record)
        self.assertEqual(len(files), 140)
        self.assertIn('package/dist/sv.js', files)
        self.assertIn('package/dist/sv.d.ts', files)
        self.assertIn(b'toZeroBasedPosition', files['package/dist/codeFrame.js'])
        self.assertIn(b'column?: number', files['package/dist/codeFrame.d.ts'])
        self.assertNotIn('package/dist/babel8.js', files)
        self.assertNotIn('package/WEBOPS-COMPAT.json', files)

    def test_old_reference_still_reproduces_and_retains_original_audit_identity(self):
        CHECKER.verify_legacy_reference()

    def test_modified_payload_and_metadata_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'integrity'):
            CHECKER.current_files(self.archive + b'changed', self.record)
        for field, value in [('version', '0.14.5'), ('license', 'changed'), ('targetRuntime', '26.13.0')]:
            record = {**self.record, field: value}
            with self.assertRaises(ValueError):
                CHECKER.current_files(self.archive, record)

    def test_changed_provider_contract_is_rejected(self):
        record = copy.deepcopy(self.record)
        record['dependencies']['@babel/code-frame'] = '^7.29.0'
        with self.assertRaisesRegex(ValueError, 'providers'):
            CHECKER.current_files(self.archive, record)

    def test_an_archive_with_a_renumbered_legacy_implementation_is_rejected(self):
        files = CHECKER.LEGACY.archive_files(self.archive)
        files['package/dist/babel8.js'] = b'retired bridge'
        archive = CHECKER.LEGACY.pack_files(files)
        record = {**self.record, 'registryIntegrity': CHECKER.LEGACY.integrity(archive), 'registryArchiveSha256': hashlib.sha256(archive).hexdigest()}
        with self.assertRaisesRegex(ValueError, 'unmodified'):
            CHECKER.current_files(archive, record)

    def test_actual_installation_rejects_missing_changed_extra_and_linked_modules(self):
        files = {'package/package.json': b'{}\n', 'package/dist/main.js': b'export default {}\n'}
        parent = CHECKER.ROOT / '.ai-work/runs'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            root = Path(temporary) / 'checker'
            (root / 'dist').mkdir(parents=True)
            (root / 'package.json').write_bytes(files['package/package.json'])
            entry = root / 'dist/main.js'
            entry.write_bytes(files['package/dist/main.js'])
            CHECKER.verify_installed(root, files)
            entry.unlink()
            with self.assertRaisesRegex(ValueError, 'missing'):
                CHECKER.verify_installed(root, files)
            entry.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'differs'):
                CHECKER.verify_installed(root, files)
            entry.unlink()
            entry.symlink_to(root / 'package.json')
            with self.assertRaisesRegex(ValueError, 'link'):
                CHECKER.verify_installed(root, files)
            entry.unlink()
            entry.write_bytes(files['package/dist/main.js'])
            (root / 'extra').write_bytes(b'undeclared')
            with self.assertRaisesRegex(ValueError, 'undeclared'):
                CHECKER.verify_installed(root, files)

    def test_only_the_immediate_package_manager_dependency_boundary_is_separate(self):
        files = {'package/package.json': b'{}\n', 'package/dist/main.js': b'export default {}\n'}
        parent = CHECKER.ROOT / '.ai-work/runs'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            root = Path(temporary) / 'checker'
            (root / 'dist').mkdir(parents=True)
            (root / 'package.json').write_bytes(files['package/package.json'])
            (root / 'dist/main.js').write_bytes(files['package/dist/main.js'])
            dependency = root / 'node_modules/provider'
            dependency.mkdir(parents=True)
            (dependency / 'package.json').write_bytes(b'{}\n')
            CHECKER.verify_installed(root, files)
            nested = root / 'dist/node_modules'
            nested.mkdir()
            (nested / 'unreviewed.js').write_bytes(b'changed\n')
            with self.assertRaisesRegex(ValueError, 'undeclared'):
                CHECKER.verify_installed(root, files)
            (nested / 'unreviewed.js').unlink()
            nested.rmdir()
            nested.symlink_to(dependency, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'link'):
                CHECKER.verify_installed(root, files)


if __name__ == '__main__':
    unittest.main()
