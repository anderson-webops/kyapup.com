import argparse
import base64
import gzip
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("unimport_source", Path(__file__).with_name("check-unimport-source.py"))
SOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SOURCE)
ROOT = SOURCE.ROOT
BUILD = SOURCE.SOURCE / "build"
TARGET = ROOT / "vendor/unimport-7.0.2-webops.2.tgz"
CONFIG = ROOT / "scripts/unimport-build.config.mjs"


def replace_once(source, original, replacement):
    SOURCE.require(source.count(original) == 1, "Changed source patch anchor requires review")
    return source.replace(original, replacement)


def maintained_source(files):
    output = dict(files)
    filename = "src/node/extract-package.ts"
    source = files[filename].decode()
    source = replace_once(source, "import os from 'node:os'", "import os from 'node:os'\nimport process from 'node:process'\nimport { pathToFileURL } from 'node:url'")
    source = replace_once(source, "  const packageJsonPath = await resolvePackageJSON(name, { url })", "  const moduleUrl = url ?? pathToFileURL(join(process.cwd(), 'package.json')).href\n  const packageJsonPath = await resolvePackageJSON(name, { url: moduleUrl })")
    source = replace_once(source, "resolveModuleExportNames(name, { url })", "resolveModuleExportNames(name, { url: moduleUrl })")
    output[filename] = source.encode()
    filename = "src/detect-acorn.ts"
    source = files[filename].decode()
    source = replace_once(source, "import { importModule, isPackageExists } from 'local-pkg'", "import { pathToFileURL } from 'node:url'\nimport { importModule, resolveModule } from 'local-pkg'")
    source = replace_once(source, "  if (!isPackageExists('acorn')) {", "  const resolved = resolveModule('acorn', { paths: [import.meta.url] })\n  if (!resolved) {")
    source = replace_once(source, "importModule<{ parse: Parse }>('acorn')", "importModule<{ parse: Parse }>(pathToFileURL(resolved).href)")
    output[filename] = source.encode()
    filename = "src/presets/vueuse-core.ts"
    source = files[filename].decode()
    source = replace_once(source, "import process from 'node:process'", "import { join } from 'node:path'\nimport process from 'node:process'\nimport { pathToFileURL } from 'node:url'")
    source = replace_once(source, "      const corePath = resolveModule('@vueuse/core') || process.cwd()", "      const paths = [pathToFileURL(join(process.cwd(), 'package.json')).href]\n      const corePath = resolveModule('@vueuse/core', { paths }) || process.cwd()")
    source = replace_once(source, "resolveModule('@vueuse/core/indexes.json')", "resolveModule('@vueuse/core/indexes.json', { paths })")
    source = replace_once(source, "resolveModule('@vueuse/metadata/index.json')", "resolveModule('@vueuse/metadata/index.json', { paths })")
    output[filename] = source.encode()
    return output


def pack_files(files):
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name, data in sorted(files.items()):
            member = tarfile.TarInfo(name)
            member.mode = 0o644
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as compressed:
        compressed.write(payload.getvalue())
    return output.getvalue()


def tool(name, expected_version=None):
    metadata = json.loads(SOURCE.regular_bytes(BUILD / "node_modules" / name / "package.json"))
    SOURCE.require(metadata["name"] == name and (expected_version is None or metadata["version"] == expected_version), "Unexpected source-build tool identity")
    entry = metadata["bin"] if isinstance(metadata["bin"], str) else metadata["bin"][name]
    filename = BUILD / "node_modules" / name / entry
    SOURCE.require(filename.resolve().is_relative_to((BUILD / "node_modules").resolve()), "Source-build tool escapes its locked graph")
    SOURCE.regular_bytes(filename)
    return str(filename)


def run(command, directory, environment):
    subprocess.run(command, cwd=directory, env=environment, timeout=300, check=True)


def build_once(original, check_upstream):
    node = shutil.which("node")
    SOURCE.require(node is not None, "The qualified Node build profile is required")
    SOURCE.require(subprocess.check_output([node, "--version"], text=True).strip() == "v26.13.0", "Review changed source-build Node version")
    manifest = json.loads(SOURCE.regular_bytes(BUILD / "package.json"))
    lock = json.loads(SOURCE.regular_bytes(BUILD / "package-lock.json"))
    SOURCE.require(lock["packages"][""]["dependencies"] == manifest["dependencies"] and lock["packages"][""]["devDependencies"] == manifest["devDependencies"], "Source-build lock does not match its manifest")
    parent = ROOT / ".ai-work/runs"
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="unimport-build-", dir=parent) as temporary:
        directory = Path(temporary)
        working = directory / "source"
        working.mkdir()
        prepared = maintained_source(original)
        for filename, data in prepared.items():
            target = working / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (working / "node_modules").symlink_to((BUILD / "node_modules").resolve(), target_is_directory=True)
        scratch = directory / "tmp"
        scratch.mkdir()
        environment = {**os.environ, "CI": "true", "TMPDIR": str(scratch), "TMP": str(scratch), "TEMP": str(scratch), "XDG_CACHE_HOME": str(directory / "cache"), "XDG_CONFIG_HOME": str(directory / "config")}
        run([node, tool("tsdown", "0.23.7"), "--config", str(CONFIG)], working, environment)
        if check_upstream:
            run([node, tool("vitest", "5.1.0"), "run"], working, environment)
            run([node, tool("vue-tsc"), "--noEmit"], working, environment)
            run([node, tool("eslint"), "."], working, environment)
        for filename, data in prepared.items():
            SOURCE.require((working / filename).read_bytes() == data, "Upstream validation changed source or snapshots")
        output = {}
        for filename in sorted((working / "dist").rglob("*")):
            if filename.is_dir():
                SOURCE.require(not filename.is_symlink(), "Built output contains a directory link")
                continue
            output["package/" + filename.relative_to(working).as_posix()] = SOURCE.regular_bytes(filename)
        for filename in ["dist/index.mjs", "dist/unplugin.mjs", "dist/addons.mjs", "dist/index.d.mts", "dist/unplugin.d.mts", "dist/addons.d.mts"]:
            SOURCE.require("package/" + filename in output, "Built package is missing a required public entrypoint")
    metadata = json.loads(original["package.json"])
    for key in ["devDependencies", "scripts", "packageManager", "resolutions"]:
        metadata.pop(key, None)
    metadata.update(version="7.0.2+webops.2", private=True, dependencies=manifest["dependencies"], engines={"node": ">=26.13.0 <27"})
    for filename in ["LICENSE", "README.md", *sorted(name for name in original if "/" not in name and name.endswith(".d.ts"))]:
        output["package/" + filename] = original[filename]
    output["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    output["package/UPSTREAM-PACKAGE.json"] = original["package.json"]
    record = json.loads((SOURCE.SOURCE / "UPSTREAM.json").read_text())
    provenance = {
        "schemaVersion": 2, "source": record,
        "build": {"node": "26.13.0", "tool": "tsdown@0.23.7", "lockSha256": hashlib.sha256((BUILD / "package-lock.json").read_bytes()).hexdigest(), "configSha256": hashlib.sha256(CONFIG.read_bytes()).hexdigest(), "producerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "sourceVerifierSha256": hashlib.sha256((ROOT / "scripts/check-unimport-source.py").read_bytes()).hexdigest()},
        "patches": {name: hashlib.sha256(prepared[name]).hexdigest() for name in sorted(original) if original[name] != prepared[name]},
        "outputSha256": {name.removeprefix("package/"): hashlib.sha256(data).hexdigest() for name, data in sorted(output.items())},
    }
    output["package/WEBOPS-SOURCE.json"] = (json.dumps(provenance, indent=2, sort_keys=True) + "\n").encode()
    return pack_files(output)


def verify_installed(data, prefix):
    lock = json.loads((prefix / "package-lock.json").read_text())["packages"]
    consumers = [(name, info) for name, info in lock.items() if name == "node_modules/unimport" or name.endswith("/node_modules/unimport")]
    SOURCE.require(bool(consumers), "The source-built provider must have a locked consumer")
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        files = {member.name.removeprefix("package/"): archive.extractfile(member).read() for member in archive}
    for name, info in consumers:
        SOURCE.require(info["version"] == "7.0.2+webops.2" and info["integrity"] == integrity, "Consuming source-built provider identity mismatch")
        directory = prefix / name
        SOURCE.require(not directory.is_symlink(), "Source-built consumer must remain local")
        for filename, content in files.items():
            SOURCE.require(SOURCE.regular_bytes(directory / filename) == content, "Installed source-built bytes mismatch")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--installed", action="store_true")
    parser.add_argument("--installed-prefix", type=Path)
    args = parser.parse_args()
    original = SOURCE.verify_source()
    first = build_once(original, True)
    second = build_once(original, False)
    SOURCE.require(first == second, "Independent source builds are not reproducible")
    if args.check:
        SOURCE.require(SOURCE.regular_bytes(TARGET) == first, "Stored source-built archive does not reproduce")
    else:
        SOURCE.require(not TARGET.is_symlink(), "Source-built output must remain local")
        TARGET.write_bytes(first)
    if args.installed:
        verify_installed(first, ROOT)
    if args.installed_prefix:
        verify_installed(first, args.installed_prefix.resolve())
    print("Signed-source unimport archive " + ("verified" if args.check else "reproduced") + " from two fresh source directories")


if __name__ == "__main__":
    main()
