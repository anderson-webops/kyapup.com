#!/usr/bin/env python3
"""Build/verify a strictly inventoried production tree; never archive runtime state."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import sys
import platform
sys.dont_write_bytecode = True

CONTRACT = Path(__file__).resolve().parent.parent / "deploy/runtime-artifact.json"
MANIFEST = "runtime-manifest.json"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def permitted(name):
    parts = PurePosixPath(name).parts
    if not parts or PurePosixPath(name).as_posix() != name or name.startswith("/"):
        return False
    top = parts[0]
    allowed = top in ("package.json", "package-lock.json", ".vitesse-release-prepared.json", MANIFEST) and len(parts) == 1
    allowed |= top == "back-end" and (len(parts) == 1 or parts[1] in ("dist", "node_modules", "package.json", "package-lock.json"))
    allowed |= top == "front-end" and (len(parts) == 1 or parts[1] == "package.json" or parts[1] == ".output" and (len(parts) == 2 or parts[2] == "public"))
    return allowed and all(
        part not in (".", "..", ".git", ".ai-work", ".npmrc", "credentials.json")
        and not part.startswith(".env")
        and not part.endswith((".pem", ".key", ".sqlite3", ".sqlite3-wal", ".sqlite3-shm"))
        for part in parts
    )


def inventory(root):
    files = {}
    for path in sorted(root.rglob("*")):
        name = path.relative_to(root).as_posix()
        if path.is_symlink() or not permitted(name):
            raise ValueError(f"forbidden artifact path: {name}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(f"not a regular file: {name}")
        if name != MANIFEST:
            files[name] = {"sha256": digest(path), "size": path.stat().st_size}
    return files


def runtime_dependencies(root):
    lock = json.loads((root / "back-end/package-lock.json").read_text())
    # Direct runtime uses the independent backend lock, never the development workspace graph.
    pending = list(json.loads(CONTRACT.read_text())["dependencyRoots"])
    visited = set()
    while pending:
        directory = pending.pop()
        if directory in visited:
            continue
        visited.add(directory)
        package_path = root / directory / "package.json"
        current = json.loads(package_path.read_text())
        pinned = lock["packages"].get(directory.removeprefix("back-end").lstrip("/"))
        if not pinned or pinned.get("version") != current.get("version") or pinned.get("dev"):
            raise ValueError(f"runtime dependency version or provenance mismatch: {directory}")
        dependencies = {**current.get("dependencies", {}), **current.get("optionalDependencies", {}), **current.get("peerDependencies", {})}
        optional = set(current.get("optionalDependencies", {})) | {name for name, value in current.get("peerDependenciesMeta", {}).items() if value.get("optional")}
        for name in dependencies:
            ancestor = PurePosixPath(directory)
            candidates = []
            while True:
                if ancestor.name != "node_modules":
                    candidates.append((ancestor / "node_modules" / name).as_posix())
                if ancestor == PurePosixPath("."):
                    break
                ancestor = ancestor.parent
            found = next((candidate for candidate in candidates if (root / candidate / "package.json").is_file()), None)
            if found:
                pending.append(found)
            elif name not in optional:
                raise ValueError(f"production dependency missing: {directory} -> {name}")
    return visited


def validate(root, manifest):
    contract = json.loads(CONTRACT.read_text())
    if manifest.get("format") != 1 or manifest.get("contract") != contract:
        raise ValueError("artifact does not match the independently trusted runtime contract")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest.get("commit", "")):
        raise ValueError("an exact source commit is required")
    actual = inventory(root)
    if actual != manifest.get("files"):
        raise ValueError("artifact paths, hashes or sizes do not match")
    for name in contract["required"]:
        if name not in actual:
            raise ValueError(f"required runtime path missing: {name}")
    package = json.loads((root / "package.json").read_text())
    lock = json.loads((root / "back-end/package-lock.json").read_text())
    workspace_lock = json.loads((root / "package-lock.json").read_text())
    backend = json.loads((root / "back-end/package.json").read_text())
    frontend = json.loads((root / "front-end/package.json").read_text())
    if len({package["version"], lock["version"], workspace_lock["version"], backend["version"], frontend["version"]}) != 1:
        raise ValueError("manifest and lock disagree")
    metadata = json.loads((root / "front-end/.output/public/release.json").read_text())
    marker = json.loads((root / ".vitesse-release-prepared.json").read_text())
    if (not isinstance(metadata, dict) or set(metadata) != {"release", "commitSha", "deployedAt"}
            or not isinstance(metadata.get("deployedAt"), str)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z", metadata["deployedAt"])):
        raise ValueError("invalid deployment identity")
    try:
        datetime.datetime.fromisoformat(metadata["deployedAt"].replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("invalid deployment identity timestamp") from error
    if metadata != marker or metadata.get("commitSha") != manifest["commit"] or metadata.get("release") != "v" + package["version"]:
        raise ValueError("static deployment identity mismatch")
    visited = runtime_dependencies(root)
    for name in actual:
        if re.search(r"(?:^|/)node_modules/(?:@[^/]+/)?[^/]+/package\.json$", name):
            directory = str(PurePosixPath(name).parent)
            if directory not in visited:
                raise ValueError(f"unrelated or development dependency in runtime: {directory}")
    for key, spec in lock["packages"].items():
        name = "back-end/" + key
        if spec.get("dev") and (root / name / "package.json").is_file():
            raise ValueError(f"development dependency in runtime: {name}")
    for key in lock["packages"]:
        name = "back-end/" + key
        if "node_modules" in PurePosixPath(name).parts and name not in visited and (root / name / "package.json").is_file():
            raise ValueError(f"unrelated dependency in runtime: {name}")
    for name in ("back-end/node_modules/tsx", "back-end/node_modules/typescript", "back-end/node_modules/vite", "back-end/node_modules/eslint"):
        if (root / name).exists():
            raise ValueError(f"development tool in runtime: {name}")
    for name in actual:
        if name.endswith(".node") or name.endswith(".so"):
            if name not in contract["nativeBindings"]:
                raise ValueError(f"undeclared native binding: {name}")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["pack", "verify", "unpack"])
    parser.add_argument("tree", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--commit")
    parser.add_argument("--sha256")
    args = parser.parse_args()
    root = args.tree.resolve(strict=True)
    if args.operation == "unpack":
        if not args.archive or not args.sha256 or not args.commit:
            parser.error("unpack requires --archive, --sha256 and --commit from the trusted release record")
        if digest(args.archive) != args.sha256 or any(root.iterdir()):
            raise ValueError("archive hash mismatch or destination not empty")
        with tarfile.open(args.archive, "r:gz") as archive:
            members = archive.getmembers()
            names = [member.name for member in members]
            if (len(names) != len(set(names)) or len(names) > 100_000
                    or sum(member.size for member in members) > 1024 * 1024 * 1024
                    or any(not member.isfile() or not permitted(member.name) for member in members)):
                raise ValueError("unsafe archive members")
            for member in members:
                target = root / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open("xb") as output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
                target.chmod(member.mode & 0o755)
        manifest = validate(root, json.loads((root / MANIFEST).read_text()))
        if manifest["commit"] != args.commit:
            raise ValueError("artifact source identity mismatch")
        print(json.dumps({"unpacked": True, "commit": manifest["commit"], "files": len(manifest["files"])}))
    elif args.operation == "pack":
        if platform.system() != "Linux" or platform.machine() != "aarch64":
            raise ValueError("Build production artifacts on Linux ARM64")
        if not args.archive or not args.commit:
            parser.error("pack requires --archive and --commit")
        if args.archive.exists():
            raise ValueError("Never overwrite an existing artifact")
        manifest = {"format": 1, "commit": args.commit,
                    "contract": json.loads(CONTRACT.read_text()), "files": inventory(root)}
        validate(root, manifest)
        (root / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n")
        with tarfile.open(args.archive, "w:gz") as archive:
            for name in sorted([MANIFEST, *manifest["files"]]):
                archive.add(root / name, arcname=name, recursive=False)
        print(json.dumps({"archive": args.archive.name, "sha256": digest(args.archive),
                          "commit": args.commit, "files": len(manifest["files"])}))
    else:
        declared = json.loads((root / MANIFEST).read_text())
        if args.archive or args.sha256:
            if not args.archive or not args.sha256 or digest(args.archive) != args.sha256:
                raise ValueError("trusted archive checksum mismatch")
            with tarfile.open(args.archive, "r:gz") as archive:
                trusted = json.load(archive.extractfile(MANIFEST))
            if declared != trusted:
                raise ValueError("staged manifest differs from trusted archive")
        manifest = validate(root, declared)
        if args.commit and manifest["commit"] != args.commit:
            raise ValueError("artifact source identity mismatch")
        print(json.dumps({"verified": True, "commit": manifest["commit"], "files": len(manifest["files"])}))


if __name__ == "__main__":
    main()
