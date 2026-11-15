import argparse
import hashlib
import importlib.util
import json
import stat
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("local_archive_tools", ROOT / "scripts/package-nft-compat.py")
ARCHIVES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARCHIVES)
IDENTITIES = {
    "braces": ("3.0.4-webops.2", "3.0.4-webops.3", "LICENSE", "index.js"),
    "deepmerge": ("4.3.2-webops.1", "4.3.2-webops.2", "license.txt", "dist/cjs.js"),
    "listhen": ("1.10.1-webops.2", "1.10.1-webops.3", "LICENSE", "dist/index.mjs"),
}
FILES = {
    "braces": ["LICENSE", "README.md", "index.js", "lib/assert-depth.js", "lib/compile.js", "lib/constants.js", "lib/expand.js", "lib/parse.js", "lib/stringify.js", "lib/utils.js", "package.json"],
    "deepmerge": ["UPSTREAM.md", "dist/cjs.js", "dist/umd.js", "index.d.ts", "license.txt", "package.json"],
    "listhen": ["LICENSE", "README.md", "bin/listhen.mjs", "cli.d.ts", "dist/chunks/xdg-open.cjs", "dist/chunks/xdg-open.mjs", "dist/cli.cjs", "dist/cli.d.cts", "dist/cli.d.mts", "dist/cli.d.ts", "dist/cli.mjs", "dist/index.cjs", "dist/index.d.cts", "dist/index.d.mts", "dist/index.d.ts", "dist/index.mjs", "dist/shared/listhen.DAqrw83w.cjs", "dist/shared/listhen.Dh3trXcM.d.cts", "dist/shared/listhen.Dh3trXcM.d.mts", "dist/shared/listhen.Dh3trXcM.d.ts", "dist/shared/listhen.tqe5I1Rl.mjs", "package.json"],
}


def regular_bytes(root, relative):
    filename = root
    for part in Path(relative).parts:
        filename = filename / part
        ARCHIVES.require(not filename.is_symlink(), "Library paths must not follow symbolic links: " + relative)
    ARCHIVES.require(stat.S_ISREG(filename.lstat().st_mode), "Library input must be regular: " + relative)
    ARCHIVES.require(filename.stat().st_size <= 1024 * 1024, "Library member exceeds its bound")
    return filename.read_bytes()


def build_archive(root, record):
    name = record["name"]
    ARCHIVES.require(name in IDENTITIES, "Unreviewed local library")
    original_version, version, license_path, entrypoint = IDENTITIES[name]
    ARCHIVES.require(record["sourceVersion"] == original_version and record["version"] == version, "Review changed library identity")
    ARCHIVES.require(set(record["files"]) == set(FILES[name]), "Required library inventory mismatch")
    ARCHIVES.require(len(record["sourceRevision"]) == 40 and all(character in "0123456789abcdef" for character in record["sourceRevision"]), "Exact source revision required")
    source = root / "vendor" / name
    ARCHIVES.require(not source.is_symlink(), "Library source must be local")
    files = {}
    for relative, digest in record["files"].items():
        data = regular_bytes(source, relative)
        ARCHIVES.require(hashlib.sha256(data).hexdigest() == digest, "Reviewed library source mismatch: " + name + "/" + relative)
        files["package/" + relative] = data
    original = files["package/package.json"]
    metadata = json.loads(original)
    ARCHIVES.require(metadata["name"] == name and metadata["version"] == original_version and metadata["license"] == "MIT", "Source library identity mismatch")
    ARCHIVES.require(not metadata.get("scripts") and not metadata.get("devDependencies"), "Library lifecycle and development tooling require review")
    ARCHIVES.require(files["package/" + license_path] and files["package/" + entrypoint], "Required license and entrypoint must be nonempty")
    metadata["version"] = version
    metadata["private"] = True
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-PACKAGE.json"] = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode()
    executable = ("package/bin/listhen.mjs",) if name == "listhen" else ()
    return ARCHIVES.pack_files(files, executable_paths=executable), files


def verify_consumers(root, record, archive, files, installed):
    name = record["name"]
    resolved = "file:vendor/" + name + "-" + record["version"] + ".tgz"
    manifest = json.loads((root / "package.json").read_text())
    ARCHIVES.require(manifest["devDependencies"][name] == resolved and manifest["overrides"][name] == "$" + name, "Application library reference mismatch")
    packages = json.loads((root / "package-lock.json").read_text())["packages"]
    consumers = [(location, metadata) for location, metadata in packages.items() if location.endswith("node_modules/" + name)]
    ARCHIVES.require(bool(consumers), "Locked library consumer required")
    ARCHIVES.require(not any(location == "vendor/" + name or location.startswith("vendor/" + name + "/") for location in packages), "Library must not form a linked npm project")
    for location, metadata in consumers:
        ARCHIVES.require(not Path(location).is_absolute() and all(part not in {"", ".", ".."} for part in location.split("/")), "Library location must remain inside the checkout")
        ARCHIVES.require(location.startswith("node_modules/") or "/node_modules/" in location, "Library consumer must be installed in a dependency tree")
        ARCHIVES.require(not metadata.get("link") and metadata.get("version") == record["version"] and metadata.get("resolved") == resolved and metadata.get("integrity") == ARCHIVES.integrity(archive), "Locked library identity or integrity mismatch")
        if installed:
            directory = root / location
            ARCHIVES.require(not directory.is_symlink(), "Installed library must not be linked")
            for relative, data in files.items():
                filename = relative.removeprefix("package/")
                ARCHIVES.require(regular_bytes(directory, filename) == data, "Installed library bytes mismatch: " + name + "/" + filename)
            if name == "listhen":
                ARCHIVES.require((directory / "bin/listhen.mjs").stat().st_mode & 0o111, "Installed listener CLI must be executable")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--installed", action="store_true")
    args = parser.parse_args()
    ARCHIVES.require(not args.installed or args.check, "Installed verification requires archive verification")
    inputs = json.loads((ROOT / "vendor/local-libraries/INPUTS.json").read_text())
    ARCHIVES.require(inputs["schemaVersion"] == 1 and set(inputs["packages"]) == set(IDENTITIES), "Local library record mismatch")
    for name, record in inputs["packages"].items():
        ARCHIVES.require(record["name"] == name, "Local library record identity mismatch")
        output, files = build_archive(ROOT, record)
        target = ROOT / "vendor" / (name + "-" + record["version"] + ".tgz")
        if args.check:
            ARCHIVES.require(regular_bytes(ROOT, str(target.relative_to(ROOT))) == output, "Library archive must reproduce reviewed source: " + name)
            verify_consumers(ROOT, record, output, files, args.installed)
        else:
            ARCHIVES.require(not target.is_symlink(), "Archive output must remain local")
            if target.exists():
                ARCHIVES.require(target.read_bytes() == output, "Existing immutable library archive differs; review a new identity")
            else:
                target.write_bytes(output)
    print("Maintained local library archives " + ("verified" if args.check else "reproduced"))


if __name__ == "__main__":
    main()
