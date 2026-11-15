import argparse
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'vendor/terminal-parents'
SPEC = importlib.util.spec_from_file_location('terminal_parent_archives', ROOT / 'scripts/package-framework-parents.py')
ARCHIVES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARCHIVES)
PACKAGES = {
    'brace-expansion': {
        'version': '5.0.13', 'count': 13, 'section': 'dependencies',
        'provider': 'balanced-match', 'before': '^4.0.2', 'after': '^5.0.0',
        'required': {'LICENSE', 'dist/esm/index.js', 'dist/esm/index.d.ts', 'dist/commonjs/index.js', 'dist/commonjs/index.d.ts'},
    },
    '@poppinss/dumper': {
        'version': '0.7.0', 'count': 26, 'section': 'dependencies',
        'provider': 'supports-color', 'before': '^10.0.0', 'after': '^11.0.0',
        'additionalProviders': [{'section': 'dependencies', 'provider': '@sindresorhus/is', 'before': '^7.0.2', 'after': '^8.1.0'}],
        'required': {'LICENSE.md', 'build/index.js', 'build/index.d.ts', 'build/chunk-26HALFTP.js', 'build/formatters/console/main.js', 'build/formatters/html/main.js'},
    },
    'jest-worker': {
        'version': '30.5.1', 'count': 8, 'section': 'dependencies',
        'provider': 'supports-color', 'before': '^8.1.1', 'after': '^11.0.0',
        'required': {'LICENSE', 'build/index.js', 'build/index.mjs', 'build/index.d.ts', 'build/processChild.js', 'build/threadChild.js'},
        'replacements': [{'file': 'build/index.js', 'before': 'const data = require("supports-color");', 'after': 'const data = require("supports-color").default;'}],
    },
    'minimizer-webpack-plugin': {
        'version': '5.14.0', 'count': 20, 'section': 'dependencies',
        'provider': 'jest-worker', 'before': '^27.4.5', 'after': '^30.5.1',
        'required': {'LICENSE', 'dist/index.js', 'dist/minify.js', 'types/index.d.ts'},
    },
    'jest-util': {
        'version': '30.5.1', 'count': 6, 'section': 'dependencies',
        'provider': 'chalk', 'before': '^4.1.2', 'after': '^6.0.1',
        'addedDependencies': {'dependencies': {'@types/picomatch': '4.0.3'}},
        'required': {'LICENSE', 'build/index.js', 'build/index.mjs', 'build/index.d.ts'},
    },
    '@jest/types': {
        'version': '30.5.1', 'count': 5, 'section': 'dependencies',
        'provider': 'chalk', 'before': '^4.1.2', 'after': '^6.0.1',
        'required': {'LICENSE', 'build/index.js', 'build/index.d.ts'},
        'replacements': [
            {'file': 'build/index.d.ts', 'before': "import {ForegroundColor} from 'chalk';", 'after': "import type {ForegroundColorName} from 'chalk';"},
            {'file': 'build/index.d.ts', 'before': 'color: typeof ForegroundColor;', 'after': 'color: ForegroundColorName;'},
        ],
    },
}
for policy in PACKAGES.values():
    policy.update({'node': '^26.13.1', 'has_bin': False})
PROVIDERS = {'balanced-match': '5.0.0', 'supports-color': '11.0.0', '@sindresorhus/is': '8.1.0', 'chalk': '6.0.1'}


def build_archive(payload, record):
    return ARCHIVES.build_archive(payload, record, PACKAGES)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--source-only', action='store_true')
    arguments = parser.parse_args()
    ARCHIVES.require(not arguments.source_only or arguments.check, 'Source-only verification requires --check')
    records = json.loads(ARCHIVES.IO.regular_bytes(SOURCE / 'UPSTREAM.json', 2 * 1024 * 1024))
    ARCHIVES.require(set(records) == set(PACKAGES), 'The complete reviewed terminal parent cohort is required')
    manifest = json.loads(ARCHIVES.IO.regular_bytes(ROOT / 'package.json', 2 * 1024 * 1024)) if arguments.check else None
    locked = json.loads(ARCHIVES.IO.regular_bytes(ROOT / 'package-lock.json', ARCHIVES.IO.MAX_EXPANDED))['packages'] if arguments.check and not arguments.source_only else None
    reference = json.loads(ARCHIVES.IO.regular_bytes(SOURCE / 'upstream/package-lock.json', ARCHIVES.IO.MAX_EXPANDED))['packages'] if locked is not None else None
    for name, record in records.items():
        ARCHIVES.require(record['package']['name'] == name and record['archive'] == ARCHIVES.original_archive(name, PACKAGES), 'Validate the exact original identity and path before reading archive bytes')
        original = ARCHIVES.IO.regular_bytes(SOURCE / record['archive'], ARCHIVES.IO.MAX_COMPRESSED)
        payload = build_archive(original, record)
        relative = 'vendor/' + ARCHIVES.maintained_archive(name, PACKAGES)
        target = ROOT / relative
        if arguments.check:
            ARCHIVES.require(ARCHIVES.IO.regular_bytes(target, ARCHIVES.IO.MAX_COMPRESSED) == payload, 'Maintained terminal parent archive no longer reproduces')
            ARCHIVES.require(manifest['devDependencies'][name] == 'file:' + relative and manifest['overrides'][name] == '$' + name, 'The actual application parent must bind the reviewed archive')
            if locked is not None:
                consumers = [(location, metadata) for location, metadata in locked.items() if location.endswith('node_modules/' + name)]
                ARCHIVES.require(bool(consumers), 'An actual locked terminal parent consumer is required')
                for location, metadata in consumers:
                    ARCHIVES.require(metadata['version'] == record['patchedVersion'] and metadata['integrity'] == ARCHIVES.IO.integrity(payload) and metadata['resolved'] == 'file:' + relative and not metadata.get('link'), 'Every actual terminal parent must bind its exact reviewed distribution')
                    ARCHIVES.verify_installed(payload, ROOT / location)
                original_metadata = reference['node_modules/' + name]
                ARCHIVES.require(original_metadata['version'] == record['package']['version'] and original_metadata['integrity'] == record['registryIntegrity'], 'The independently locked original identity must remain intact')
                ARCHIVES.verify_installed(original, SOURCE / 'upstream/node_modules' / name)
        else:
            ARCHIVES.IO.write_regular(target, payload)
        print(json.dumps({'name': name, 'originalFiles': len(record['files']), 'archive': relative, 'integrity': ARCHIVES.IO.integrity(payload)}))
    if locked is not None:
        for name, version in PROVIDERS.items():
            consumers = [(location, metadata) for location, metadata in locked.items() if location.endswith('node_modules/' + name)]
            ARCHIVES.require(bool(consumers) and all(metadata['version'] == version for location, metadata in consumers), 'Every application provider must use its reviewed current major: ' + name)


if __name__ == '__main__':
    main()
