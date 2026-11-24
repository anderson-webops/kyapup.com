import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'vendor/vite-plugin-checker'
LEGACY_SPEC = importlib.util.spec_from_file_location('checker_legacy_reference', ROOT / 'scripts/package-checker-compat.py')
LEGACY = importlib.util.module_from_spec(LEGACY_SPEC)
LEGACY_SPEC.loader.exec_module(LEGACY)
IO_SPEC = importlib.util.spec_from_file_location('checker_source_io', ROOT / 'scripts/package-native-providers.py')
IO = importlib.util.module_from_spec(IO_SPEC)
IO_SPEC.loader.exec_module(IO)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def current_files(payload, record):
    require(record['schemaVersion'] == 1 and record['name'] == 'vite-plugin-checker', 'Unsupported current checker record')
    require(record['version'] == '1.0.0', 'Review a changed checker release')
    require(LEGACY.integrity(payload) == record['registryIntegrity'], 'Current checker registry integrity mismatch')
    require(hashlib.sha256(payload).hexdigest() == record['registryArchiveSha256'], 'Current checker source digest mismatch')
    files = LEGACY.archive_files(payload)
    metadata = json.loads(files['package/package.json'])
    require(metadata['name'] == record['name'] and metadata['version'] == record['version'], 'Current checker identity mismatch')
    require(metadata['license'] == record['license'] == 'MIT', 'Preserve the original checker license')
    require(metadata['exports'] == record['expectedExports'], 'Review changed checker entrypoints')
    require(metadata['engines'] == record['expectedEngines'], 'Review changed checker runtime requirements')
    require(record['targetRuntime'] == '26.13.1', 'Review a changed application runtime')
    require(record['dependencies'] == {'@babel/code-frame': '^8.0.0', 'chokidar': '^6.0.0'}, 'Review changed checker providers')
    for name, version in record['dependencies'].items():
        require(metadata['dependencies'].get(name) == version, 'Current checker provider mismatch')
    require('package/dist/babel8.js' not in files and 'package/WEBOPS-COMPAT.json' not in files, 'Current checker must retain official unmodified bytes')
    require(b'column ? column - 1' in files['package/dist/codeFrame.js'], 'Review the native Babel8 position conversion')
    require(b'column?: number' in files['package/dist/codeFrame.d.ts'], 'Review the native optional-column contract')
    return files


def verify_installed(directory, files):
    require(directory.is_dir() and not directory.is_symlink(), 'Installed checker must be a regular directory')
    expected = {name.removeprefix('package/'): payload for name, payload in files.items()}
    actual = set()
    for base, directories, filenames in os.walk(directory, followlinks=False):
        if Path(base) == directory and 'node_modules' in directories:
            directories.remove('node_modules')
        for name in directories:
            require(not (Path(base) / name).is_symlink(), 'Installed checker contains a link')
        for name in filenames:
            filename = Path(base) / name
            require(not filename.is_symlink(), 'Installed checker contains a link')
            relative = filename.relative_to(directory).as_posix()
            require(relative in expected, 'Installed checker contains an undeclared file')
            require(IO.regular_bytes(filename, IO.MAX_EXPANDED) == expected[relative], 'Installed checker differs from the official archive')
            actual.add(relative)
    require(actual == set(expected), 'Installed checker is missing an original module')


def verify_legacy_reference():
    record = json.loads(IO.regular_bytes(SOURCE / 'UPSTREAM.json', IO.MAX_COMPRESSED))
    original = IO.regular_bytes(SOURCE / record['archive'], IO.MAX_COMPRESSED)
    archive = LEGACY.build_archive(
        original, record,
        IO.regular_bytes(SOURCE / 'babel8.js', IO.MAX_COMPRESSED),
        IO.regular_bytes(SOURCE / 'babel8.d.ts', IO.MAX_COMPRESSED),
    )
    require(IO.regular_bytes(LEGACY.TARGET, IO.MAX_COMPRESSED) == archive, 'Retired checker archive no longer reproduces')
    baseline = json.loads(IO.regular_bytes(SOURCE / 'upstream/package-lock.json', IO.MAX_EXPANDED))
    metadata = baseline['packages']['node_modules/vite-plugin-checker']
    require(metadata['version'] == record['version'] and metadata['integrity'] == record['integrity'], 'Historical comparison must retain its exact official identity')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-only', action='store_true')
    arguments = parser.parse_args()
    record = json.loads(IO.regular_bytes(SOURCE / 'CURRENT.json', IO.MAX_COMPRESSED))
    require(record['archive'] == 'upstream/vite-plugin-checker-1.0.0.tgz', 'Unexpected current checker input path')
    files = current_files(IO.regular_bytes(SOURCE / record['archive'], IO.MAX_COMPRESSED), record)
    verify_legacy_reference()
    if not arguments.source_only:
        lock = json.loads(IO.regular_bytes(ROOT / 'package-lock.json', IO.MAX_EXPANDED))
        consumers = [(name, metadata) for name, metadata in lock['packages'].items() if name.endswith('node_modules/vite-plugin-checker')]
        require(bool(consumers), 'Current checker needs an actual locked consumer')
        for name, metadata in consumers:
            require(metadata['version'] == record['version'] and metadata['integrity'] == record['registryIntegrity'], 'Every active checker must bind the official current release')
            verify_installed(ROOT / name, files)
        parent = json.loads(IO.regular_bytes(ROOT / 'node_modules/@nuxt/vite-builder/package.json', IO.MAX_COMPRESSED))
        require(parent['version'] == '4.7.0', 'Use the reviewed official Nuxt Vite-builder parent')
        require(parent['dependencies']['vite-plugin-checker'] == '^1.0.0', 'The actual Nuxt parent must admit checker1')
    print(json.dumps({'checker': record['version'], 'officialFiles': len(files), 'historicalReferencePreserved': True, 'scope': 'source-only' if arguments.source_only else 'source-lock-and-installed-parents'}))


if __name__ == '__main__':
    main()
