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
SOURCE = ROOT / "vendor/vite-plugin-checker"
TARGET = ROOT / "vendor/vite-plugin-checker-0.14.5-webops.1.tgz"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def archive_files(data):
    require(len(data) <= 1024 * 1024, "Compressed archive exceeds its bound")
    files = {}
    seen = set()
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            name = member.name
            require(name not in seen, "Duplicate archive member")
            seen.add(name)
            require((name.startswith("package/") or (name == "package" and member.isdir())) and not PurePosixPath(name).is_absolute() and not any(part in {"", ".", ".."} for part in name.rstrip("/").split("/")), "Archive member must remain inside package")
            require(member.isfile() or member.isdir(), "Only regular files and directories are accepted")
            if member.isdir():
                continue
            total += member.size
            require(total <= 2 * 1024 * 1024, "Archive payload exceeds its bound")
            files[name] = archive.extractfile(member).read()
    require({"package/package.json", "package/LICENSE", "package/dist/codeFrame.js", "package/dist/codeFrame.d.ts", "package/dist/logger.d.ts", "package/dist/@runtime/main.js"} <= files.keys(), "Required upstream module, types or license is missing")
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


def replace_once(source, original, replacement):
    require(source.count(original) == 1, "Changed upstream integration anchor requires review")
    return source.replace(original, replacement)


def build_archive(data, upstream, bridge, declarations):
    require(upstream["schemaVersion"] == 1 and integrity(data) == upstream["integrity"], "Upstream archive integrity mismatch")
    files = archive_files(data)
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata["name"] == upstream["name"] == "vite-plugin-checker" and metadata["version"] == upstream["version"] == "0.14.5", "Unexpected upstream identity")
    require(metadata["license"] == "MIT" and upstream["patchedVersion"] == "0.14.5-webops.1", "Preserve the reviewed distribution identity")
    require(metadata["dependencies"]["@babel/code-frame"] == "^7.29.0" and upstream["dependencies"] == {"@babel/code-frame": "8.0.6"}, "Review changed dependency contracts")
    metadata["version"] = upstream["patchedVersion"]
    metadata["private"] = True
    metadata["engines"]["node"] = "^22.18.0 || >=24.11.0"
    metadata["dependencies"].update(upstream["dependencies"])
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    for name in ["codeFrame.js", "codeFrame.d.ts", "logger.d.ts"]:
        filename = "package/dist/" + name
        files[filename] = replace_once(files[filename].decode(), 'from "@babel/code-frame"', 'from "./babel8.js"').encode()
    for name in ["codeFrame.js.map", "logger.js.map"]:
        filename = "package/dist/" + name
        mapping = json.loads(files[filename])
        require(len(mapping["sourcesContent"]) == 1, "Review changed source-map inputs")
        mapping["sourcesContent"][0] = replace_once(mapping["sourcesContent"][0], "from '@babel/code-frame'", "from './babel8.js'")
        files[filename] = (json.dumps(mapping, separators=(",", ":")) + "\n").encode()
    for filename in ["package/dist/babel8.js", "package/dist/babel8.d.ts", "package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"]:
        require(filename not in files, "Reserved provenance or bridge member already exists")
    files["package/dist/babel8.js"] = bridge
    files["package/dist/babel8.d.ts"] = declarations
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(upstream, indent=2) + "\n").encode()
    return pack_files(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    upstream = json.loads((SOURCE / "UPSTREAM.json").read_text())
    require(upstream["archive"] == "upstream/vite-plugin-checker-0.14.5.tgz", "Unexpected original archive path")
    original = SOURCE / upstream["archive"]
    require(stat.S_ISREG(original.lstat().st_mode), "Original archive must be a regular file")
    output = build_archive(original.read_bytes(), upstream, (SOURCE / "babel8.js").read_bytes(), (SOURCE / "babel8.d.ts").read_bytes())
    if args.check:
        require(stat.S_ISREG(TARGET.lstat().st_mode), "Maintained archive must be a regular file")
        require(TARGET.read_bytes() == output, "Maintained checker archive does not reproduce")
        lock = json.loads((ROOT / "package-lock.json").read_text())
        consumers = [metadata for name, metadata in lock["packages"].items() if name.endswith("/vite-plugin-checker")]
        require(bool(consumers), "The maintained checker must have a locked consumer")
        for consumer in consumers:
            require(consumer["version"] == upstream["patchedVersion"] and consumer["integrity"] == integrity(output), "Consuming lock integrity mismatch")
        baseline = json.loads((SOURCE / "upstream/package-lock.json").read_text())["packages"]["node_modules/vite-plugin-checker"]
        require(baseline["version"] == upstream["version"] and baseline["integrity"] == upstream["integrity"], "Original-version auditing must retain its exact official identity")
        for filename, data in archive_files(output).items():
            require((ROOT / "node_modules/vite-plugin-checker" / filename.removeprefix("package/")).read_bytes() == data, "Installed checker bytes do not match the accepted archive")
    else:
        require(not TARGET.is_symlink(), "Maintained output must remain local")
        TARGET.write_bytes(output)
    print("Maintained checker archive " + ("verified" if args.check else "reproduced"))


if __name__ == "__main__":
    main()
