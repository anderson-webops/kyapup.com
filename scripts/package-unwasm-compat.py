import argparse
import gzip
import importlib.util
import io
import json
import stat
import tarfile
from pathlib import Path, PurePosixPath


SPEC = importlib.util.spec_from_file_location("nitro_tool_inputs", Path(__file__).with_name("check-nitro-tool-inputs.py"))
INPUTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INPUTS)
ROOT = INPUTS.ROOT
SOURCE = INPUTS.SOURCE
TARGET = ROOT / "vendor/unwasm-0.6.3-webops.1.tgz"


def replace_once(source, original, replacement):
    INPUTS.require(source.count(original) == 1, "Changed upstream integration anchor requires review")
    return source.replace(original, replacement)


def pack_files(files):
    payload = io.BytesIO()
    directories = {str(parent) for name in files for parent in PurePosixPath(name).parents if str(parent) != "."}
    with tarfile.open(fileobj=payload, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(directories):
            member = tarfile.TarInfo(name)
            member.type = tarfile.DIRTYPE
            member.mode = 0o755
            archive.addfile(member)
        for name, data in sorted(files.items()):
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = 0o644
            archive.addfile(member, io.BytesIO(data))
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as compressed:
        compressed.write(payload.getvalue())
    return output.getvalue()


def build_archive(data, record):
    info = record["packages"]["unwasm"]
    INPUTS.require(info["version"] == "0.6.3" and INPUTS.integrity(data) == info["integrity"], "Original WASM archive integrity mismatch")
    INPUTS.require(record["wasmBridge"]["version"] == "0.6.3-webops.1" and record["wasmBridge"]["archive"] == TARGET.name, "Review changed maintained identity")
    files = INPUTS.archive_files(data)
    original = files["package/package.json"]
    metadata = json.loads(original)
    INPUTS.require(metadata["name"] == "unwasm" and metadata["version"] == "0.6.3" and metadata["license"] == "MIT", "Original WASM identity mismatch")
    metadata["version"] = "0.6.3-webops.1"
    metadata["private"] = True
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    source = files["package/dist/plugin/index.mjs"].decode()
    source = replace_once(source, 'if (resolvedId.startsWith("file://")) resolvedId = fileURLToPath(resolvedId);', 'if (resolvedId.startsWith("file://")) resolvedId = fileURLToPath(resolvedId);\n\t\t\t\t\t\tconst query = id.includes("?") ? id.slice(id.indexOf("?")) : "";\n\t\t\t\t\t\tif (query && !resolvedId.includes("?")) resolvedId += query;')
    source = replace_once(source, "const resolved = this.resolve(id, importer);", 'const resolved = this.resolve(id.split("?")[0], importer);')
    source = replace_once(source, 'const resolved = importAlias && typeof importAlias === "string" ? importAlias : resolveModulePath(moduleName, { from: asset.id });', '''let resolved;
        if (importAlias && typeof importAlias === "string") resolved = importAlias;
        else {
          try {
            resolved = resolveModulePath(moduleName, { from: asset.id });
          } catch (error) {
            if (error?.code !== "MODULE_NOT_FOUND" && error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
            return { code: "const _imports = undefined;", resolved: false };
          }
        }''')
    files["package/dist/plugin/index.mjs"] = source.encode()
    for filename in ["package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"]:
        INPUTS.require(filename not in files, "Reserved provenance member already exists")
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps({"original": info, "bridge": record["wasmBridge"]}, indent=2) + "\n").encode()
    return pack_files(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    record = json.loads((SOURCE / "UPSTREAM.json").read_text())
    filename = SOURCE / "upstream/unwasm-0.6.3.tgz"
    INPUTS.require(stat.S_ISREG(filename.lstat().st_mode), "Original archive must be a regular file")
    output = build_archive(filename.read_bytes(), record)
    if args.check:
        INPUTS.require(stat.S_ISREG(TARGET.lstat().st_mode) and TARGET.read_bytes() == output, "Maintained WASM archive does not reproduce")
        lock = json.loads((ROOT / "package-lock.json").read_text())["packages"]
        consumers = [(location, metadata) for location, metadata in lock.items() if location.endswith("/unwasm")]
        INPUTS.require(bool(consumers), "The maintained WASM provider must have a locked consumer")
        for location, metadata in consumers:
            INPUTS.require(metadata["version"] == "0.6.3-webops.1" and metadata["integrity"] == INPUTS.integrity(output), "Consuming WASM identity mismatch")
            for name, data in INPUTS.archive_files(output).items():
                file = ROOT / location / name.removeprefix("package/")
                INPUTS.require(stat.S_ISREG(file.lstat().st_mode) and file.read_bytes() == data, "Installed WASM bytes mismatch")
    else:
        INPUTS.require(not TARGET.is_symlink(), "Maintained output must remain local")
        TARGET.write_bytes(output)
    print("Maintained WASM archive " + ("verified" if args.check else "reproduced"))


if __name__ == "__main__":
    main()
