import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('terminal_parent_tests', Path(__file__).with_name('package-terminal-parents.py'))
PRODUCER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCER)
ARCHIVES = PRODUCER.ARCHIVES
RECORDS = json.loads((PRODUCER.SOURCE / 'UPSTREAM.json').read_text())


class TerminalParentTests(unittest.TestCase):
    def originals(self):
        for name, record in RECORDS.items():
            yield name, (PRODUCER.SOURCE / record['archive']).read_bytes(), record

    def changed_record(self, files, modes, record):
        payload = ARCHIVES.pack_files(files, modes)
        changed = copy.deepcopy(record)
        changed['registryIntegrity'] = ARCHIVES.IO.integrity(payload)
        changed['registryArchiveSha256'] = hashlib.sha256(payload).hexdigest()
        changed['files'] = {name.removeprefix('package/'): {'sha256': hashlib.sha256(contents).hexdigest(), 'mode': modes[name]} for name, contents in files.items()}
        return payload, changed

    def test_all_six_complete_originals_and_licenses_reproduce(self):
        self.assertEqual(set(RECORDS), set(PRODUCER.PACKAGES))
        self.assertEqual(sum(len(record['files']) for record in RECORDS.values()), 78)
        for name, original, record in self.originals():
            with self.subTest(name=name):
                payload = PRODUCER.build_archive(original, record)
                maintained, modes = ARCHIVES.archive_files(payload)
                files, original_modes = ARCHIVES.archive_files(original)
                metadata = json.loads(maintained['package/package.json'])
                self.assertEqual(metadata['version'], record['patchedVersion'])
                self.assertEqual(metadata['engines']['node'], '^26.13.1')
                self.assertTrue(metadata['private'])
                self.assertNotIn('bin', metadata)
                self.assertEqual(maintained['package/UPSTREAM-PACKAGE.json'], files['package/package.json'])
                self.assertEqual(json.loads(maintained['package/WEBOPS-PARENT.json']), record)
                policy = PRODUCER.PACKAGES[name]
                changed_sources = {change['file'] for change in policy.get('replacements', [])}
                for filename, contents in files.items():
                    self.assertEqual(modes[filename], original_modes[filename])
                    if filename != 'package/package.json' and filename.removeprefix('package/') not in changed_sources:
                        self.assertEqual(maintained[filename], contents, filename)
                self.assertEqual(len(maintained), len(files) + 2)
                self.assertEqual(payload, (PRODUCER.ROOT / 'vendor' / ARCHIVES.maintained_archive(name, PRODUCER.PACKAGES)).read_bytes())

    def test_actual_dependency_contracts_change_only_the_reviewed_providers(self):
        for name, original, record in self.originals():
            maintained, modes = ARCHIVES.archive_files(PRODUCER.build_archive(original, record))
            metadata = json.loads(maintained['package/package.json'])
            expected = copy.deepcopy(record['package'])
            policy = PRODUCER.PACKAGES[name]
            expected.update({'version': record['patchedVersion'], 'private': True})
            expected.setdefault('engines', {})['node'] = '^26.13.1'
            for provider in [policy, *policy.get('additionalProviders', [])]:
                expected[provider['section']][provider['provider']] = provider['after']
            for section, dependencies in policy.get('addedDependencies', {}).items():
                expected.setdefault(section, {}).update(dependencies)
            self.assertEqual(metadata, expected, name)
            self.assertEqual(modes['package/UPSTREAM-PACKAGE.json'], 0o644)

    def test_framework_defaults_still_reproduce_every_maintained_archive(self):
        original_records = json.loads((ARCHIVES.SOURCE / 'UPSTREAM.json').read_text())
        self.assertEqual(set(original_records), set(ARCHIVES.PACKAGES))
        for name, record in original_records.items():
            original = (ARCHIVES.SOURCE / record['archive']).read_bytes()
            self.assertEqual(ARCHIVES.build_archive(original, record), (PRODUCER.ROOT / 'vendor' / ARCHIVES.maintained_archive(name)).read_bytes())
        for name, original, record in self.originals():
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unknown framework parent'):
                ARCHIVES.build_archive(original, record)

    def test_the_worker_adapts_only_the_native_esm_default_export(self):
        record = RECORDS['jest-worker']
        original = (PRODUCER.SOURCE / record['archive']).read_bytes()
        files, modes = ARCHIVES.archive_files(original)
        maintained, maintained_modes = ARCHIVES.archive_files(PRODUCER.build_archive(original, record))
        entry = 'package/build/index.js'
        self.assertEqual(maintained[entry], files[entry].replace(b'const data = require("supports-color");', b'const data = require("supports-color").default;'))
        self.assertEqual(maintained_modes[entry], modes[entry])
        files[entry] = files[entry].replace(b'const data = require("supports-color");', b'const data = unreviewedProvider;')
        payload, changed = self.changed_record(files, modes, record)
        with self.assertRaisesRegex(ValueError, 'source correction no longer matches'):
            PRODUCER.build_archive(payload, changed)

    def test_all_provider_before_contracts_are_verified(self):
        record = RECORDS['@poppinss/dumper']
        original = (PRODUCER.SOURCE / record['archive']).read_bytes()
        for provider in ['supports-color', '@sindresorhus/is']:
            files, modes = ARCHIVES.archive_files(original)
            metadata = json.loads(files['package/package.json'])
            metadata['dependencies'][provider] = 'unreviewed'
            files['package/package.json'] = (json.dumps(metadata) + '\n').encode()
            payload, changed = self.changed_record(files, modes, record)
            changed['package'] = metadata
            with self.subTest(provider=provider), self.assertRaisesRegex(ValueError, 'Original provider contract changed'):
                PRODUCER.build_archive(payload, changed)

    def test_types_adapt_the_actual_chalk_contract_and_declare_the_missing_type_provider(self):
        record = RECORDS['@jest/types']
        original = (PRODUCER.SOURCE / record['archive']).read_bytes()
        files, modes = ARCHIVES.archive_files(original)
        maintained, maintained_modes = ARCHIVES.archive_files(PRODUCER.build_archive(original, record))
        entry = 'package/build/index.d.ts'
        expected = files[entry].replace(b"import {ForegroundColor} from 'chalk';", b"import type {ForegroundColorName} from 'chalk';").replace(b'color: typeof ForegroundColor;', b'color: ForegroundColorName;')
        self.assertEqual(maintained[entry], expected)
        self.assertEqual(maintained_modes[entry], modes[entry])
        files[entry] = files[entry].replace(b'color: typeof ForegroundColor;', b'color: unreviewed;')
        payload, changed = self.changed_record(files, modes, record)
        with self.assertRaisesRegex(ValueError, 'source correction no longer matches'):
            PRODUCER.build_archive(payload, changed)
        record = RECORDS['jest-util']
        original = (PRODUCER.SOURCE / record['archive']).read_bytes()
        files, modes = ARCHIVES.archive_files(original)
        metadata = json.loads(files['package/package.json'])
        metadata['dependencies']['@types/picomatch'] = 'unreviewed'
        files['package/package.json'] = (json.dumps(metadata) + '\n').encode()
        payload, changed = self.changed_record(files, modes, record)
        changed['package'] = metadata
        with self.assertRaisesRegex(ValueError, 'already declared added dependency'):
            PRODUCER.build_archive(payload, changed)

    def test_changed_inventory_modes_identity_exports_and_payload_are_rejected(self):
        for name, original, record in self.originals():
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'integrity'):
                PRODUCER.build_archive(original + b'changed', record)
            for field, value in [('archive', '../outside.tgz'), ('patchedVersion', 'unreviewed')]:
                changed = {**record, field: value}
                with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                    PRODUCER.build_archive(original, changed)
            changed = copy.deepcopy(record)
            changed['package']['exports'] = {'unreviewed': './missing.js'}
            with self.subTest(name=name, field='exports'), self.assertRaisesRegex(ValueError, 'metadata changed'):
                PRODUCER.build_archive(original, changed)
            files, modes = ARCHIVES.archive_files(original)
            modes['package/package.json'] = 0o600
            payload, changed = self.changed_record(files, modes, record)
            with self.subTest(name=name, field='mode'), self.assertRaisesRegex(ValueError, 'reviewed regular-file modes'):
                PRODUCER.build_archive(payload, changed)
            for relative in PRODUCER.PACKAGES[name]['required']:
                files, modes = ARCHIVES.archive_files(original)
                del files['package/' + relative]
                del modes['package/' + relative]
                payload, changed = self.changed_record(files, modes, record)
                with self.subTest(name=name, missing=relative), self.assertRaises(ValueError):
                    PRODUCER.build_archive(payload, changed)

    def test_non_cli_parents_reject_new_unreviewed_commands(self):
        for name, original, record in self.originals():
            files, modes = ARCHIVES.archive_files(original)
            metadata = json.loads(files['package/package.json'])
            metadata['bin'] = {'unreviewed-command': 'package.json'}
            files['package/package.json'] = (json.dumps(metadata) + '\n').encode()
            payload, changed = self.changed_record(files, modes, record)
            changed['package'] = metadata
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'CLI ownership'):
                PRODUCER.build_archive(payload, changed)

    def test_original_paths_are_checked_before_reading_an_archive(self):
        records = copy.deepcopy(RECORDS)
        records[next(iter(records))]['archive'] = '../outside.tgz'
        reads = []

        def read(filename, maximum):
            reads.append(filename)
            self.assertEqual(filename, PRODUCER.SOURCE / 'UPSTREAM.json')
            return json.dumps(records).encode()

        with patch.object(ARCHIVES.IO, 'regular_bytes', side_effect=read), patch('sys.argv', ['package-terminal-parents.py']):
            with self.assertRaisesRegex(ValueError, 'before reading archive bytes'):
                PRODUCER.main()
        self.assertEqual(len(reads), 1)

    def test_complete_installed_bytes_and_directory_boundaries_are_checked(self):
        record = RECORDS['jest-worker']
        payload = PRODUCER.build_archive((PRODUCER.SOURCE / record['archive']).read_bytes(), record)
        files, modes = ARCHIVES.archive_files(payload)
        base = PRODUCER.ROOT / '.ai-work/runs'
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as temporary:
            directory = Path(temporary)
            for filename, contents in files.items():
                target = directory / filename.removeprefix('package/')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(contents)
                target.chmod(modes[filename])
            ARCHIVES.verify_installed(payload, directory)
            nested = directory / 'node_modules/managed-provider'
            nested.mkdir(parents=True)
            (nested / 'package.json').write_text('{}')
            ARCHIVES.verify_installed(payload, directory)
            entry = directory / 'build/index.js'
            entry.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'bytes differ'):
                ARCHIVES.verify_installed(payload, directory)
            entry.unlink()
            entry.symlink_to(directory / 'package.json')
            with self.assertRaises((ValueError, OSError)):
                ARCHIVES.verify_installed(payload, directory)


if __name__ == '__main__':
    unittest.main()
