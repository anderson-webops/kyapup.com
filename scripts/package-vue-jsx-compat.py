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
SOURCE = ROOT / "vendor/vue-jsx"
TARGET = ROOT / "vendor/plugin-vue-jsx-5.1.6-webops.1.tgz"
ORIGINAL_DEPENDENCIES = {
    "@babel/core": "^7.29.0",
    "@babel/plugin-syntax-typescript": "^7.29.7",
    "@babel/plugin-transform-typescript": "^7.29.7",
    "@vue/babel-plugin-jsx": "^2.0.1",
}
DEPENDENCIES = {
    "@babel/core": "^8.1.0",
    "@babel/plugin-syntax-typescript": "^8.0.3",
    "@babel/plugin-transform-typescript": "^8.0.6",
    "@vue/babel-plugin-jsx": "^3.0.0",
}
ORIGINAL_PURE = '\t\t\t\t\t\t\t\tconst callee = _path.node.callee;\n\t\t\t\t\t\t\t\tcallee.name = `/* @__PURE__ */ ${callee.name}`;'
MODERN_PURE = '\t\t\t\t\t\t\t\ttypes.addComment(_path.node, "leading", "#__PURE__");'


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
            require(total <= 1024 * 1024, "Archive payload exceeds its bound")
            files[name] = archive.extractfile(member).read()
    require({"package/package.json", "package/LICENSE", "package/dist/index.mjs", "package/dist/index.d.mts"} <= files.keys(), "Required upstream module, types or license is missing")
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


def build_archive(data, upstream):
    require(len(data) <= 1024 * 1024, "Compressed upstream archive exceeds its bound")
    require(upstream["schemaVersion"] == 1, "Unsupported upstream record")
    require(integrity(data) == upstream["integrity"], "Upstream archive integrity mismatch")
    files = archive_files(data)
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata["name"] == upstream["name"] == "@vitejs/plugin-vue-jsx", "Unexpected package identity")
    require(metadata["version"] == upstream["version"] == "5.1.6", "Unexpected upstream version")
    require(metadata["license"] == "MIT", "Preserve the original license")
    require(upstream["patchedVersion"] == "5.1.6-webops.1" and upstream["dependencies"] == DEPENDENCIES, "Use the qualified Babel contract")
    for name, version in ORIGINAL_DEPENDENCIES.items():
        require(metadata["dependencies"][name] == version, "Unexpected original dependency")
    metadata["version"] = upstream["patchedVersion"]
    metadata["private"] = True
    metadata["engines"]["node"] = "^22.18.0 || >=24.11.0"
    metadata["dependencies"].update(DEPENDENCIES)
    metadata["peerDependencies"]["vite"] = "^8.3.6"
    metadata["peerDependencies"]["vue"] = "^3.5.45"
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    module = files["package/dist/index.mjs"].decode()
    require(module.count(ORIGINAL_PURE) == 1, "Expected upstream purity transform is missing")
    require(module.count("babel.createConfigItem(") == 2, "Expected synchronous TypeScript configuration calls are missing")
    module = module.replace("babel.createConfigItem(", "babel.createConfigItemSync(")
    files["package/dist/index.mjs"] = module.replace(ORIGINAL_PURE, MODERN_PURE).encode()
    require("package/UPSTREAM-PACKAGE.json" not in files and "package/WEBOPS-COMPAT.json" not in files, "Reserved provenance member already exists")
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(upstream, indent=2) + "\n").encode()
    return pack_files(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    upstream = json.loads((SOURCE / "UPSTREAM.json").read_text())
    require(upstream["archive"] == "upstream/plugin-vue-jsx-5.1.6.tgz", "Use the reviewed local upstream archive")
    filename = SOURCE / upstream["archive"]
    require(stat.S_ISREG(filename.lstat().st_mode), "Upstream input must be a regular file")
    archive = build_archive(filename.read_bytes(), upstream)
    if arguments.check:
        require(stat.S_ISREG(TARGET.lstat().st_mode), "Compatibility input must be a regular file")
        require(TARGET.read_bytes() == archive, "Compatibility archive does not reproduce")
        lock = json.loads((ROOT / "package-lock.json").read_text())
        consumers = [metadata for name, metadata in lock["packages"].items() if name.endswith("/@vitejs/plugin-vue-jsx")]
        require(bool(consumers), "The maintained JSX provider must have a locked consumer")
        for consumer in consumers:
            require(consumer["version"] == upstream["patchedVersion"] and consumer["integrity"] == integrity(archive), "Every consuming lock must bind the qualified archive")
        original = json.loads((SOURCE / "upstream/package-lock.json").read_text())["packages"]["node_modules/@vitejs/plugin-vue-jsx"]
        require(original["version"] == upstream["version"] and original["integrity"] == upstream["integrity"], "Original-version auditing must retain the official identity")
        print("Vue JSX Babel8 archive reproduces; original types, license and independent audit identity are preserved.")
    else:
        require(not TARGET.is_symlink(), "Compatibility output must remain local")
        TARGET.write_bytes(archive)
        print(json.dumps({"archive": str(TARGET.relative_to(ROOT)), "integrity": integrity(archive)}))


if __name__ == "__main__":
    main()
