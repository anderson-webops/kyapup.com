import argparse
import base64
import gzip
import hashlib
import io
import json
import stat
import tarfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/unplugin-remove"
TARGET = ROOT / "vendor/unplugin-remove-1.0.3-webops.1.tgz"
ADAPTERS = ("vite", "rollup", "rolldown", "esbuild", "webpack", "rspack")
DEPENDENCIES = {
    "@babel/parser": "^8.1.0", "@babel/traverse": "^8.1.0", "@babel/types": "^8.1.0",
    "@rollup/pluginutils": "^5.5.1", "magic-string": "^1.4.5", "unplugin": "^3.7.0",
}
NATIVE_TYPES = {
    "vite": ("Plugin", "vite"), "rollup": ("Plugin", "rollup"),
    "rolldown": ("Plugin", "rolldown"), "esbuild": ("Plugin", "esbuild"),
    "webpack": ("WebpackPluginInstance", "webpack"),
    "rspack": ("RspackPluginInstance", "@rspack/core"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def archive_files(data):
    files = {}
    seen = set()
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            name = member.name
            require(name not in seen, "Duplicate archive member")
            seen.add(name)
            require(
                (name.startswith("package/") or (name == "package" and member.isdir()))
                and not PurePosixPath(name).is_absolute()
                and not any(part in {"", ".", ".."} for part in name.rstrip("/").split("/")),
                "Archive member must remain inside package",
            )
            require(member.isfile() or member.isdir(), "Only regular files and directories are accepted")
            if member.isdir():
                continue
            total += member.size
            require(total <= 16 * 1024 * 1024, "Archive payload exceeds its bound")
            files[name] = archive.extractfile(member).read()
    require({"package/package.json", "package/LICENSE", "package/dist/index.js", "package/dist/index.d.ts", "package/dist/index.cjs"} <= files.keys(), "Required upstream module, types or license is missing")
    return files


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


def adapter_declaration(adapter):
    name, module = NATIVE_TYPES[adapter]
    return f'import type {{ {name} }} from "{module}";\nimport type {{ Options }} from "./types.js";\ndeclare const remove: (options?: Options) => {name};\nexport default remove;\n'.encode()


def build_archive(data, upstream, source):
    require(len(data) <= 16 * 1024 * 1024, "Compressed upstream archive exceeds its bound")
    require(upstream["schemaVersion"] == 1 and integrity(data) == upstream["integrity"], "Upstream archive integrity mismatch")
    files = archive_files(data)
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata["name"] == upstream["name"] == "unplugin-remove" and metadata["version"] == upstream["version"] == "1.0.3", "Unexpected upstream identity")
    require(metadata["license"] == "MIT", "Preserve the original license")
    require(upstream["patchedVersion"] == "1.0.3-webops.1" and upstream["dependencies"] == DEPENDENCIES, "Use the qualified compiler contract")
    require(upstream["embeddedLegacyTypes"] == "7.25.2", "Review a changed bundled dependency")
    require(metadata["dependencies"]["unplugin"] == "^1.12.0" and metadata["dependencies"]["magic-string"] == "^0.30.11", "Review changed original dependency ranges")
    chunks = [name for name in files if name.startswith("package/dist/chunk-") and name.endswith(".js")]
    require(len(chunks) == 1 and b"@babel+types@7.25.2" in files[chunks[0]], "Review a changed bundled compiler payload")
    del files[chunks[0]]
    metadata["version"] = upstream["patchedVersion"]
    metadata["private"] = True
    metadata["engines"] = {"node": "^22.18.0 || >=24.11.0"}
    metadata["dependencies"] = DEPENDENCIES
    metadata["types"] = "dist/index.d.ts"
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    files["package/dist/index.js"] = source
    files["package/dist/index.cjs"] = b'module.exports = require("./index.js");\n'
    for adapter in ADAPTERS:
        for suffix in ("d.ts", "d.cts"):
            filename = f"package/dist/{adapter}.{suffix}"
            require(filename in files, "Preserve every original typed adapter entrypoint")
            files[filename] = adapter_declaration(adapter)
        for suffix in ("js", "cjs"):
            filename = f"package/dist/{adapter}.{suffix}"
            require(filename in files, "Preserve every original adapter entrypoint")
            if suffix == "js":
                files[filename] = f'import plugin from "./index.js";\nexport default plugin.{adapter};\n'.encode()
            else:
                files[filename] = f'Object.defineProperty(exports, "__esModule", {{ value: true }});\nexports.default = require("./index.js").default.{adapter};\n'.encode()
    require("package/UPSTREAM-PACKAGE.json" not in files and "package/WEBOPS-COMPAT.json" not in files, "Reserved provenance member already exists")
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(upstream, indent=2) + "\n").encode()
    require(not any(b"@babel+types@7.25.2" in value for name, value in files.items() if name.endswith((".js", ".cjs"))), "Legacy bundled compiler must be absent")
    return pack_files(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    upstream = json.loads((SOURCE / "UPSTREAM.json").read_text())
    require(upstream["archive"] == "upstream/unplugin-remove-1.0.3.tgz", "Use the reviewed local upstream archive")
    filename = SOURCE / upstream["archive"]
    source = SOURCE / "index.js"
    require(stat.S_ISREG(filename.lstat().st_mode) and stat.S_ISREG(source.lstat().st_mode), "Inputs must be regular files")
    archive = build_archive(filename.read_bytes(), upstream, source.read_bytes())
    if arguments.check:
        require(stat.S_ISREG(TARGET.lstat().st_mode) and TARGET.read_bytes() == archive, "Compatibility archive does not reproduce")
        lock = json.loads((ROOT / "package-lock.json").read_text())
        consumers = [metadata for name, metadata in lock["packages"].items() if name.endswith("/unplugin-remove")]
        require(bool(consumers), "The maintained removal provider must have a locked consumer")
        for consumer in consumers:
            require(consumer["version"] == upstream["patchedVersion"] and consumer["integrity"] == integrity(archive), "Every consuming lock must bind the qualified archive")
        original_lock = json.loads((SOURCE / "upstream/package-lock.json").read_text())["packages"]
        original = original_lock["node_modules/unplugin-remove"]
        require(original["version"] == upstream["version"] and original["integrity"] == upstream["integrity"], "Original-version auditing must retain the official identity")
        require(original_lock["node_modules/@babel/types"]["version"] == upstream["embeddedLegacyTypes"], "Audit the exact formerly bundled compiler identity")
        print("Removal compiler archive reproduces; original declarations/license and independent bundled-version audit identity are preserved.")
    else:
        require(not TARGET.is_symlink(), "Compatibility output must remain local")
        TARGET.write_bytes(archive)
        print(json.dumps({"archive": str(TARGET.relative_to(ROOT)), "integrity": integrity(archive)}))


if __name__ == "__main__":
    main()
