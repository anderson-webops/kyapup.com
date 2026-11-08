import base64
import hashlib
import io
import json
import stat
import tarfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/nitro-tools"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def archive_files(data):
    require(len(data) <= 4 * 1024 * 1024, "Compressed archive exceeds its bound")
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
            require(total <= 8 * 1024 * 1024, "Archive payload exceeds its bound")
            files[name] = archive.extractfile(member).read()
    require({"package/package.json", "package/LICENSE"} <= files.keys(), "Required package metadata or license is missing")
    return files


def verify_package(info):
    require(info["archive"] == info["name"] + "-" + info["version"] + ".tgz", "Unexpected original archive path")
    original = SOURCE / "upstream" / info["archive"]
    require(stat.S_ISREG(original.lstat().st_mode), "Original archive must be a regular file")
    data = original.read_bytes()
    require(integrity(data) == info["integrity"], "Original archive integrity mismatch")
    files = archive_files(data)
    metadata = json.loads(files["package/package.json"])
    require(metadata["name"] == info["name"] and metadata["version"] == info["version"], "Original package identity mismatch")
    directory = ROOT / info["installed"]
    require(not directory.is_symlink(), "Installed package must remain local")
    for name, content in files.items():
        filename = directory / name.removeprefix("package/")
        require(stat.S_ISREG(filename.lstat().st_mode) and filename.read_bytes() == content, "Installed package differs from its original distribution: " + info["name"] + "/" + name)
    lock = json.loads((ROOT / info["lock"]).read_text())
    provider = lock["packages"]["node_modules/" + info["name"]]
    require(provider["version"] == info["version"] and provider["integrity"] == info["integrity"], "Consuming lock identity mismatch")


def main():
    record = json.loads((SOURCE / "UPSTREAM.json").read_text())
    require(record["schemaVersion"] == 1 and set(record["packages"]) == {"nitropack", "unctx", "unwasm", "original-unctx", "original-unwasm"}, "Review changed package identities")
    expected = {"magic-string": "1.4.5", "unctx": "3.0.1", "unwasm": "$unwasm"}
    require(record["nitroProviderContract"] == expected, "Review changed provider contract")
    manifest = json.loads((ROOT / "package.json").read_text())
    require(manifest["overrides"]["nitropack"] == {".": "$nitropack", **expected}, "Nitro must use the qualified maintained parent and scoped providers")
    require(manifest["devDependencies"]["nitropack"] == "file:vendor/nitropack-2.13.6-webops.1.tgz", "Nitro must select the exact maintained framework archive")
    for info in record["packages"].values():
        verify_package(info)
    print("Five original distributions match their installed bytes and exact consuming locks")


if __name__ == "__main__":
    main()
