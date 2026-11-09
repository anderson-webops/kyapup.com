import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/vite-plugin-vue-devtools"
TARGET = ROOT / "vendor/vite-plugin-vue-devtools-9.0.0-rc.3-webops.1.tgz"
MAX_COMPRESSED = 4 * 1024 * 1024
MAX_EXPANDED = 16 * 1024 * 1024
REQUIRED = {
    "package/package.json",
    "package/LICENSE",
    "package/dist/index.mjs",
    "package/dist/index.d.mts",
    "package/dist/client.mjs",
    "package/dist/client.d.mts",
    "package/client/index.html",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def regular_bytes(filename, maximum):
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "Input must be a regular file")
        data = stream.read(maximum + 1)
    require(len(data) <= maximum, "Input exceeds its size bound")
    return data


def archive_files(data):
    require(len(data) <= MAX_COMPRESSED, "Compressed archive exceeds its bound")
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as stream:
        expanded = stream.read(MAX_EXPANDED + 1)
    require(len(expanded) <= MAX_EXPANDED, "Expanded archive exceeds its bound")
    files = {}
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(expanded), mode="r:") as archive:
        for member in archive:
            name = member.name
            require(len(seen) < 1000 and name not in seen, "Too many or duplicate archive members")
            seen.add(name)
            require(
                (name.startswith("package/") or name == "package" and member.isdir())
                and not PurePosixPath(name).is_absolute()
                and all(part not in {"", ".", ".."} for part in name.rstrip("/").split("/")),
                "Archive member must remain inside package",
            )
            require(member.isfile() or member.isdir(), "Only regular files and directories are accepted")
            if member.isdir():
                continue
            require(member.size <= MAX_EXPANDED, "Archive member exceeds its bound")
            files[name] = archive.extractfile(member).read()
    require(REQUIRED <= files.keys(), "Required module, declarations, UI or license is missing")
    return files


def patched_metadata(original, upstream):
    metadata = json.loads(original)
    require(upstream["schemaVersion"] == 2, "Unsupported upstream record")
    require(metadata == upstream["package"], "Original package metadata changed")
    require(metadata["name"] == "vite-plugin-vue-devtools", "Unexpected package identity")
    require(metadata["version"] == "9.0.0-rc.3", "Unexpected upstream version")
    require(metadata["license"] == "MIT", "Preserve the original license")
    require(metadata["peerDependencies"]["@vitejs/devtools"] == "^0.7.6", "Unexpected original host contract")
    require(metadata["dependencies"]["@vitejs/devtools-kit"] == "^0.8.2", "Unexpected original kit contract")
    require(upstream["patchedVersion"] == "9.0.0-rc.3+webops.1", "Use the qualified distribution identity")
    require(upstream["hostRange"] == "^0.8.2", "Use the qualified host contract")
    metadata["version"] = upstream["patchedVersion"]
    metadata["private"] = True
    metadata["peerDependencies"]["@vitejs/devtools"] = upstream["hostRange"]
    return (json.dumps(metadata, indent=2) + "\n").encode()


def pack_files(files):
    payload = io.BytesIO()
    directories = set()
    for name in files:
        directories.update(str(parent) for parent in PurePosixPath(name).parents if str(parent) != ".")
    with tarfile.open(fileobj=payload, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(directories):
            member = tarfile.TarInfo(name)
            member.type = tarfile.DIRTYPE
            member.mode = 0o755
            archive.addfile(member)
        for name, data in sorted(files.items()):
            member = tarfile.TarInfo(name)
            member.mode = 0o644
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as compressed:
        compressed.write(payload.getvalue())
    return output.getvalue()


def build_archive(data, upstream):
    require(integrity(data) == upstream["registryIntegrity"], "Official archive integrity mismatch")
    require(hashlib.sha256(data).hexdigest() == upstream["registryArchiveSha256"], "Official archive digest mismatch")
    files = archive_files(data)
    require(len(files) == 39 and set(files) == {"package/" + name for name in upstream["files"]}, "Complete upstream file inventory changed")
    for name, content in files.items():
        require(hashlib.sha256(content).hexdigest() == upstream["files"][name.removeprefix("package/")], "Original payload changed")
    original = files["package/package.json"]
    files["package/package.json"] = patched_metadata(original, upstream)
    require("package/UPSTREAM-PACKAGE.json" not in files and "package/WEBOPS-COMPAT.json" not in files, "Reserved provenance member already exists")
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(upstream, indent=2) + "\n").encode()
    return pack_files(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    upstream = json.loads(regular_bytes(SOURCE / "UPSTREAM.json", 1024 * 1024))
    require(upstream["archive"] == "upstream/vite-plugin-vue-devtools-9.0.0-rc.3.tgz", "Use the reviewed original input")
    archive = build_archive(regular_bytes(SOURCE / upstream["archive"], MAX_COMPRESSED), upstream)
    if arguments.check:
        require(regular_bytes(TARGET, MAX_COMPRESSED) == archive, "Maintained archive does not reproduce")
        lock = json.loads(regular_bytes(ROOT / "package-lock.json", 8 * 1024 * 1024))
        consumers = [value for name, value in lock["packages"].items() if name.endswith("/vite-plugin-vue-devtools")]
        require(bool(consumers), "The maintained plugin must have a locked consumer")
        for consumer in consumers:
            require(consumer["version"] == upstream["patchedVersion"] and consumer["integrity"] == integrity(archive), "Every consumer must bind the qualified archive")
        original_lock = json.loads(regular_bytes(SOURCE / "upstream/package-lock.json", 8 * 1024 * 1024))
        original = original_lock["packages"]["node_modules/vite-plugin-vue-devtools"]
        require(original["version"] == upstream["package"]["version"] and original["integrity"] == upstream["registryIntegrity"], "Original auditing must retain the official identity")
        print("Vue DevTools distribution reproduces with every original module, declaration, UI and license preserved.")
    else:
        descriptor = os.open(TARGET, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | os.O_NONBLOCK, 0o644)
        with os.fdopen(descriptor, "wb") as stream:
            require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "Output must be a regular file")
            stream.write(archive)
        print(json.dumps({"archive": str(TARGET.relative_to(ROOT)), "integrity": integrity(archive)}))


if __name__ == "__main__":
    main()
