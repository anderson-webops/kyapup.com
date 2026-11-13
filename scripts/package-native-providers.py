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
SOURCE = ROOT / "vendor/native-providers"
MAX_COMPRESSED = 4 * 1024 * 1024
MAX_EXPANDED = 16 * 1024 * 1024
PACKAGES = {
    "eslint-plugin-format": {
        "version": "2.0.1",
        "revision": 2,
        "dependency": "oxfmt",
        "originalRange": "^0.35.0",
        "qualifiedRange": "^0.78.0",
        "fileCount": 10,
        "required": {"LICENSE", "dist/index.mjs", "dist/index.d.mts", "dts/rule-options.d.ts", "workers/oxfmt.cjs", "workers/prettier.cjs", "workers/dprint.cjs"},
    },
    "@unocss/transformer-attributify-jsx": {
        "version": "66.13.0",
        "dependency": "oxc-parser",
        "originalRange": "^0.153.0",
        "qualifiedRange": "^0.158.0",
        "fileCount": 4,
        "required": {"README.md", "dist/index.mjs", "dist/index.d.mts"},
    },
    "unconfig": {
        "version": "7.5.0",
        "dependency": "unconfig-core",
        "originalRange": "7.5.0",
        "qualifiedRange": "7.5.0",
        "fileCount": 9,
        "required": {"LICENSE", "dist/index.mjs", "dist/index.d.mts", "dist/presets.mjs", "dist/presets.d.mts", "presets.d.ts"},
        "replacement": {
            "file": "dist/index.d.mts",
            "before": "[force?: Args[0] | undefined]",
            "after": "[force?: boolean | undefined]",
        },
    },
    "@unocss/vite": {
        "version": "66.13.0",
        "dependency": "@unocss/core",
        "originalRange": "66.13.0",
        "qualifiedRange": "66.13.0",
        "fileCount": 6,
        "required": {"README.md", "dist/client.mjs", "dist/client.d.mts", "dist/index.mjs", "dist/index.d.mts"},
        "replacement": {
            "file": "dist/index.mjs",
            "before": "\t\t\ttransform(code, id) {\n\t\t\t\treturn applyTransformers(ctx, code, id, order);\n\t\t\t},",
            "after": "\t\t\ttransform: {\n\t\t\t\torder: order === \"pre\" ? \"pre\" : void 0,\n\t\t\t\thandler(code, id) {\n\t\t\t\t\treturn applyTransformers(ctx, code, id, order);\n\t\t\t\t}\n\t\t\t},",
        },
        "additionalReplacements": [
            {
                "file": "dist/index.mjs",
                "before": indent + "transform(code, id) {\n" + indent + "\tif (filter(code, id)) tasks.push(extract(code, id));\n" + indent + "\treturn null;\n" + indent + "},",
                "after": indent + "transform: {\n" + indent + "\torder: \"pre\",\n" + indent + "\thandler(code, id) {\n" + indent + "\t\tif (filter(code, id)) tasks.push(extract(code, id));\n" + indent + "\t\treturn null;\n" + indent + "\t}\n" + indent + "},",
            }
            for indent in ["\t\t", "\t\t\t"]
        ],
    },
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
        payload = stream.read(maximum + 1)
    require(len(payload) <= maximum, "Input exceeds its size bound")
    return payload


def archive_files(data):
    require(len(data) <= MAX_COMPRESSED, "Compressed archive exceeds its bound")
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as compressed:
        expanded = compressed.read(MAX_EXPANDED + 1)
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
    return files


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


def build_archive(data, record):
    name = record["package"]["name"]
    require(name in PACKAGES, "Unreviewed parent package")
    policy = PACKAGES[name]
    require(record["schemaVersion"] == 1, "Unsupported upstream record")
    require(integrity(data) == record["registryIntegrity"], "Original archive integrity mismatch")
    require(hashlib.sha256(data).hexdigest() == record["registryArchiveSha256"], "Original archive digest mismatch")
    files = archive_files(data)
    require(len(files) == policy["fileCount"], "Original file count changed")
    require({"package/package.json", *("package/" + filename for filename in policy["required"])} <= files.keys(), "Required source, types, worker or license is missing")
    require(set(files) == {"package/" + filename for filename in record["files"]}, "Complete original inventory changed")
    for filename, content in files.items():
        require(hashlib.sha256(content).hexdigest() == record["files"][filename.removeprefix("package/")], "Original file bytes changed")
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata == record["package"], "Original package metadata changed")
    require(metadata["version"] == policy["version"] and metadata["license"] == "MIT", "Preserve the reviewed version and license")
    require(metadata["dependencies"][policy["dependency"]] == policy["originalRange"], "Original native provider requirement changed")
    require(record["qualifiedRange"] == policy["qualifiedRange"], "Unreviewed native provider range")
    require(record["patchedVersion"] == policy["version"] + "-webops." + str(policy.get("revision", 1)), "Unreviewed maintained identity")
    require(record["archive"] == "upstream/" + name.replace("@", "").replace("/", "-") + "-" + policy["version"] + ".tgz", "Use the exact original archive path")
    require("package/UPSTREAM-PACKAGE.json" not in files and "package/WEBOPS-COMPAT.json" not in files, "Reserved provenance member already exists")
    metadata["version"] = record["patchedVersion"]
    metadata["private"] = True
    metadata["dependencies"][policy["dependency"]] = policy["qualifiedRange"]
    if "replacement" in policy:
        for change in [policy["replacement"], *policy.get("additionalReplacements", [])]:
            filename = "package/" + change["file"]
            require(files[filename].count(change["before"].encode()) == 1, "Reviewed source no longer matches")
            files[filename] = files[filename].replace(change["before"].encode(), change["after"].encode())
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(record, indent=2) + "\n").encode()
    return pack_files(files)


def write_regular(filename, payload):
    descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o644)
    with os.fdopen(descriptor, "wb") as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1, "Output must be an unshared regular file")
        os.ftruncate(stream.fileno(), 0)
        stream.write(payload)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    records = json.loads(regular_bytes(SOURCE / "UPSTREAM.json", 1024 * 1024))
    require(set(records) == set(PACKAGES), "The complete reviewed parent cohort is required")
    lock = json.loads(regular_bytes(ROOT / "package-lock.json", 8 * 1024 * 1024)) if arguments.check else None
    original_lock = json.loads(regular_bytes(SOURCE / "upstream/package-lock.json", 4 * 1024 * 1024)) if arguments.check else None
    for name, record in records.items():
        require(record["package"]["name"] == name, "Upstream record identity mismatch")
        expected_archive = "upstream/" + name.replace("@", "").replace("/", "-") + "-" + PACKAGES[name]["version"] + ".tgz"
        require(record["archive"] == expected_archive, "Validate the original archive path before reading")
        payload = build_archive(regular_bytes(SOURCE / record["archive"], MAX_COMPRESSED), record)
        target = ROOT / "vendor" / (name.replace("@", "").replace("/", "-") + "-" + record["patchedVersion"] + ".tgz")
        if arguments.check:
            require(regular_bytes(target, MAX_COMPRESSED) == payload, "Maintained archive does not reproduce")
            consumers = [value for filename, value in lock["packages"].items() if filename.endswith("node_modules/" + name)]
            require(bool(consumers), "Maintained parent has no locked consumer")
            require(all(value["version"] == record["patchedVersion"] and value["integrity"] == integrity(payload) for value in consumers), "Every consumer must bind the maintained archive")
            original = original_lock["packages"]["node_modules/" + name]
            require(original["version"] == record["package"]["version"] and original["integrity"] == record["registryIntegrity"], "Original audit graph must retain the registry identity")
        else:
            write_regular(target, payload)
        print(json.dumps({"archive": str(target.relative_to(ROOT)), "integrity": integrity(payload), "originalFiles": len(record["files"])}))


if __name__ == "__main__":
    main()
