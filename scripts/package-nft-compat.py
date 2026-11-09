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
SOURCE = ROOT / "vendor/nft"
TARGET = ROOT / "vendor/vercel-nft-1.11.1-webops.1.tgz"


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


def pack_files(files, executable_paths=("package/out/cli.js",)):
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
            member.mode = 0o755 if name in executable_paths else 0o644
            archive.addfile(member, io.BytesIO(data))
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as compressed:
        compressed.write(payload.getvalue())
    return output.getvalue()


def replace_once(source, before, after):
    require(source.count(before) == 1, "Changed upstream integration anchor requires review")
    return source.replace(before, after)


def build_archive(data, record):
    require(record["schemaVersion"] == 1 and record["name"] == "@vercel/nft" and record["version"] == "1.11.1" and record["patchedVersion"] == "1.11.1-webops.1", "Review changed maintained identity")
    require(record["walker"]["version"] == "3.0.3", "Review changed walker identity")
    require(record["syncTools"] == "@rollup/pluginutils@5.5.1-webops.1", "Review changed synchronous tool provider")
    require(integrity(data) == record["integrity"], "Original archive integrity mismatch")
    files = archive_files(data)
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata["name"] == record["name"] and metadata["version"] == record["version"] and metadata["license"] == "MIT", "Original package identity mismatch")
    require(metadata["dependencies"]["estree-walker"] == "2.0.2", "Review changed original walker dependency")
    source = files["package/out/analyze.js"].decode()
    source = replace_once(source, 'const estree_walker_1 = require("estree-walker");\n', '')
    source = replace_once(source, '    await (0, estree_walker_1.asyncWalk)(ast, {', '    const { asyncWalk } = await import("estree-walker");\n    await asyncWalk(ast, {')
    metadata["version"] = record["patchedVersion"]
    metadata["private"] = True
    metadata["dependencies"]["estree-walker"] = record["walker"]["version"]
    require(metadata["dependencies"]["@rollup/pluginutils"] == "^5.1.3", "Review changed original utility dependency")
    metadata["dependencies"]["@rollup/pluginutils"] = "5.5.1-webops.1"
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    files["package/out/analyze.js"] = source.encode()
    files["package/out/utils/wrappers.js"] = replace_once(files["package/out/utils/wrappers.js"].decode(), 'require("estree-walker")', 'require("@rollup/pluginutils/webops-tools.cjs")').encode()
    for name in ["package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"]:
        require(name not in files, "Reserved provenance member already exists")
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(record, indent=2) + "\n").encode()
    return pack_files(files)


def verify_installed(directory, files):
    require(not directory.is_symlink(), "Installed provider must remain local")
    for name, data in files.items():
        filename = directory / name.removeprefix("package/")
        require(stat.S_ISREG(filename.lstat().st_mode) and filename.read_bytes() == data, "Installed package bytes mismatch: " + name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    record = json.loads((SOURCE / "UPSTREAM.json").read_text())
    require(record["archive"] == "vercel-nft-1.11.1.tgz" and record["walker"]["archive"] == "estree-walker-3.0.3.tgz", "Review changed input paths")
    output = build_archive((SOURCE / "upstream" / record["archive"]).read_bytes(), record)
    if args.check:
        require(stat.S_ISREG(TARGET.lstat().st_mode) and TARGET.read_bytes() == output, "Maintained archive does not reproduce")
        lock = json.loads((ROOT / "package-lock.json").read_text())["packages"]
        consumers = [(location, metadata) for location, metadata in lock.items() if location.endswith("/@vercel/nft")]
        require(bool(consumers), "A locked file-tracer consumer is required")
        for location, metadata in consumers:
            require(metadata["version"] == record["patchedVersion"] and metadata["integrity"] == integrity(output), "Consuming file-tracer integrity mismatch")
            verify_installed(ROOT / location, archive_files(output))
        walker = record["walker"]
        original = (SOURCE / "upstream" / walker["archive"]).read_bytes()
        require(integrity(original) == walker["integrity"], "Walker original integrity mismatch")
        provider = lock["node_modules/estree-walker"]
        require(provider["version"] == walker["version"] and provider["integrity"] == walker["integrity"], "Actual Walker lock mismatch")
        verify_installed(ROOT / "node_modules/estree-walker", archive_files(original))
        original_lock = json.loads((SOURCE / "upstream/package-lock.json").read_text())["packages"]["node_modules/@vercel/nft"]
        require(original_lock["version"] == record["version"] and original_lock["integrity"] == record["integrity"], "Original fixture lock mismatch")
        verify_installed(SOURCE / "upstream/node_modules/@vercel/nft", archive_files((SOURCE / "upstream" / record["archive"]).read_bytes()))
    else:
        require(not TARGET.is_symlink(), "Maintained archive output must remain local")
        TARGET.write_bytes(output)
    print("Maintained file-tracer archive " + ("verified" if args.check else "reproduced"))


if __name__ == "__main__":
    main()
