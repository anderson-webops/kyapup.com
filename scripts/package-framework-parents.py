import argparse
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tarfile


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/framework-parents"
BUILDER_NAME = "@nuxt/vite-builder"
BUILDER_VERSION = "4.7.0"
BUILDER_INTEGRITY = "sha512-W3tFmdjgew5nGvXNLHt8IdVV3rj+XXQ4EovKBE7pNKGu8mBJuiYUkmz0XvOp/IBhaZTPOIyVm2NjLbpjAEuqVw=="
SPEC = importlib.util.spec_from_file_location("native_package_io", ROOT / "scripts/package-native-providers.py")
IO = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IO)
PACKAGES = {
    "vite": {
        "version": "8.3.8",
        "revision": 1,
        "count": 37,
        "section": "dependencies",
        "provider": "rolldown",
        "before": "~1.2.18",
        "after": "~1.3.0",
        "required": {"LICENSE.md", "bin/vite.js", "client.d.ts", "dist/client/client.mjs", "dist/node/index.js", "dist/node/index.d.ts", "dist/node/chunks/node.js"},
        "replacements": [
            {
                "file": "dist/node/index.d.ts",
                "before": "  load?: ObjectHook<(this: PluginContext, id: string, options?: {",
                "after": "  load?: ObjectHook<(this: PluginContext, id: string, options?: Partial<Rolldown.LoadExtraOptions> & {",
            },
            {
                "file": "dist/node/chunks/node.js",
                "before": 'const preloadMarkerRE = new RegExp(preloadMarker, "g");',
                "after": 'const preloadMarkerRE = new RegExp(preloadMarker + "(?:[a-f0-9]{32})?(?![a-zA-Z0-9_$])", "g");\nfunction preloadMarkerEnd(code, start) {\n\tpreloadMarkerRE.lastIndex = start;\n\tconst match = preloadMarkerRE.exec(code);\n\tif (!match || match.index !== start) throw new Error("Unsupported Vite preload marker span");\n\treturn preloadMarkerRE.lastIndex;\n}',
            },
            {
                "file": "dist/node/chunks/node.js",
                "before": "markerStartPos + preloadMarker.length",
                "after": "preloadMarkerEnd(code, markerStartPos)",
                "count": 4,
            },
        ],
    },
    "nuxt": {
        "version": "4.7.0",
        "revision": 1,
        "count": 465,
        "section": "peerDependencies",
        "provider": "rolldown",
        "before": "~1.2.1",
        "after": "~1.3.0",
        "required": {"LICENSE", "bin/nuxt.mjs", "types.d.mts", "dist/index.mjs", "dist/index.js", "dist/app/index.js", "dist/server/index.js"},
        "replacements": [
            {
                "file": filename,
                "before": '\t\tconst unctxTransform = UnctxTransformPlugin({',
                "after": '\t\tnuxt.options.build.transpile.push("unctx");\n\t\tconst unctxTransform = UnctxTransformPlugin({',
            }
            for filename in ["dist/index.mjs", "dist/index.js"]
        ],
    },
    "nitropack": {
        "version": "2.13.6",
        "count": 340,
        "section": "dependencies",
        "provider": "c12",
        "before": "^3.3.4",
        "after": "^4.0.0-rc.4",
        "required": {"LICENSE", "dist/cli/index.mjs", "dist/core/index.mjs", "dist/core/index.d.ts", "dist/config/index.mjs", "dist/runtime/index.mjs"},
    },
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def archive_files(payload):
    files = IO.archive_files(payload)
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        modes = {item.name: item.mode for item in archive if item.isfile()}
    require(set(files) == set(modes), "Every file needs its original permission mode")
    require(set(modes.values()) <= {0o644, 0o755}, "Only reviewed regular-file modes are allowed")
    return files, modes


def pack_files(files, modes):
    require(set(files) == set(modes), "Every output file needs a reviewed mode")
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(files):
            member = tarfile.TarInfo(name)
            member.mode = modes[name]
            member.size = len(files[name])
            archive.addfile(member, io.BytesIO(files[name]))
    output = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=output, mode="wb", mtime=0, compresslevel=9) as compressed:
        compressed.write(payload.getvalue())
    return output.getvalue()


def original_archive(name, policies=None):
    policy = (PACKAGES if policies is None else policies)[name]
    return "upstream/" + name.removeprefix("@").replace("/", "-") + "-" + policy["version"] + ".tgz"


def maintained_archive(name, policies=None):
    policy = (PACKAGES if policies is None else policies)[name]
    return name.removeprefix("@").replace("/", "-") + "-" + policy["version"] + "-webops." + str(policy.get("revision", 1)) + ".tgz"


def build_archive(payload, record, policies=None):
    policies = PACKAGES if policies is None else policies
    name = record["package"]["name"]
    require(name in policies, "Unknown framework parent")
    policy = policies[name]
    require(record["schemaVersion"] == 1, "Unsupported parent input schema")
    require(record["archive"] == original_archive(name, policies), "Use the reviewed original archive path")
    require(record["patchedVersion"] == policy["version"] + "+webops." + str(policy.get("revision", 1)), "Use the reviewed maintained build identity")
    require(record["registryIntegrity"] == IO.integrity(payload), "Original registry integrity mismatch")
    require(record["registryArchiveSha256"] == hashlib.sha256(payload).hexdigest(), "Original archive digest mismatch")
    files, modes = archive_files(payload)
    require(len(files) == policy["count"], "Complete original framework inventory changed")
    require({"package/package.json", *("package/" + filename for filename in policy["required"])} <= files.keys(), "Required framework runtime, CLI, types or license missing")
    require(set(files) == {"package/" + filename for filename in record["files"]}, "Complete original source paths changed")
    for filename, contents in files.items():
        original = record["files"][filename.removeprefix("package/")]
        require(hashlib.sha256(contents).hexdigest() == original["sha256"], "Original source bytes changed")
        require(modes[filename] == original["mode"], "Original executable/file mode changed")
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata == record["package"], "Original framework metadata changed")
    require(metadata["version"] == policy["version"] and metadata["license"] == "MIT", "Preserve the reviewed original version and license")
    providers = [policy, *policy.get("additionalProviders", [])]
    for provider in providers:
        require(metadata[provider["section"]][provider["provider"]] == provider["before"], "Original provider contract changed")
    for section, dependencies in policy.get("addedDependencies", {}).items():
        for dependency in dependencies:
            require(dependency not in metadata.get(section, {}), "Review an already declared added dependency")
    require(("bin" in metadata) == policy.get("has_bin", True), "Review changed framework CLI ownership")
    for filename in metadata.get("bin", {}).values():
        command = "package/" + filename.removeprefix("./")
        require(command in files and modes[command] == 0o755, "Required framework CLI must retain executable mode")
    for change in policy.get("replacements", []):
        filename = "package/" + change["file"]
        require(files[filename].count(change["before"].encode()) == change.get("count", 1), "Reviewed framework source correction no longer matches")
        files[filename] = files[filename].replace(change["before"].encode(), change["after"].encode())
    for filename in ["package/UPSTREAM-PACKAGE.json", "package/WEBOPS-PARENT.json"]:
        require(filename not in files, "Reserved source provenance member already exists")
    metadata["version"] = record["patchedVersion"]
    metadata["private"] = True
    for provider in providers:
        metadata[provider["section"]][provider["provider"]] = provider["after"]
    for section, dependencies in policy.get("addedDependencies", {}).items():
        metadata.setdefault(section, {}).update(dependencies)
    if "node" in policy:
        metadata.setdefault("engines", {})["node"] = policy["node"]
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-PARENT.json"] = (json.dumps(record, indent=2) + "\n").encode()
    modes["package/UPSTREAM-PACKAGE.json"] = 0o644
    modes["package/WEBOPS-PARENT.json"] = 0o644
    return pack_files(files, modes)


def verify_installed(payload, directory):
    require(directory.is_dir() and not directory.is_symlink(), "Installed framework parent must be a real local directory")
    files, modes = archive_files(payload)
    actual = set()
    for base, directories, filenames in os.walk(directory, followlinks=False):
        if Path(base) == directory and "node_modules" in directories:
            directories.remove("node_modules")
        for name in directories:
            require(not (Path(base) / name).is_symlink(), "Installed framework directory must not redirect source checks")
        actual.update("package/" + (Path(base) / name).relative_to(directory).as_posix() for name in filenames)
    require(actual == set(files), "Complete installed framework source inventory differs")
    for filename, contents in files.items():
        relative = Path(filename.removeprefix("package/"))
        for parent in relative.parents:
            folder = directory / parent
            require(folder.is_dir() and not folder.is_symlink(), "Installed framework directory must not redirect source checks")
        target = directory / relative
        require(IO.regular_bytes(target, IO.MAX_EXPANDED) == contents, "Installed framework bytes differ: " + filename)
        require(stat.S_IMODE(target.lstat().st_mode) & 0o111 == modes[filename] & 0o111, "Installed framework executable mode differs")


def current_builder_files(payload):
    require(IO.integrity(payload) == BUILDER_INTEGRITY, "Official Nuxt builder integrity mismatch")
    files, _modes = archive_files(payload)
    metadata = json.loads(files["package/package.json"])
    require(metadata["name"] == BUILDER_NAME and metadata["version"] == BUILDER_VERSION, "Official Nuxt builder identity mismatch")
    require(metadata["license"] == "MIT" and "bin" not in metadata, "Review Nuxt builder licensing or CLI ownership")
    require(len(files) == 19 and {"package/LICENSE", "package/dist/index.mjs", "package/dist/index.d.mts"} <= files.keys(), "Required Nuxt builder inventory changed")
    require(metadata["dependencies"]["vite-plugin-checker"] == "^1.0.0", "The official Nuxt builder must admit checker 1")
    require(b"/@vite-plugin-checker-runtime-entry" not in files["package/dist/index.mjs"], "The obsolete checker runtime entry must remain absent")
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    records = json.loads(IO.regular_bytes(SOURCE / "UPSTREAM.json", 1024 * 1024))
    require(set(records) == set(PACKAGES), "The complete reviewed framework cohort is required")
    locked = json.loads(IO.regular_bytes(ROOT / "package-lock.json", 8 * 1024 * 1024))["packages"] if arguments.check else None
    reference = json.loads(IO.regular_bytes(SOURCE / "upstream/package-lock.json", 8 * 1024 * 1024))["packages"] if arguments.check else None
    for name, record in records.items():
        require(record["package"]["name"] == name and record["archive"] == original_archive(name), "Validate exact source identity and path before reading archive bytes")
        payload = build_archive(IO.regular_bytes(SOURCE / record["archive"], IO.MAX_COMPRESSED), record)
        target = ROOT / "vendor" / maintained_archive(name)
        if arguments.check:
            require(IO.regular_bytes(target, IO.MAX_COMPRESSED) == payload, "Maintained framework archive does not reproduce")
            consumers = [value for filename, value in locked.items() if filename.endswith("node_modules/" + name)]
            require(bool(consumers), "Maintained framework has no locked consumer")
            require(all(value["version"] == record["patchedVersion"] and value["integrity"] == IO.integrity(payload) for value in consumers), "Every actual framework parent must bind its reviewed distribution")
            for filename in locked:
                if filename.endswith("node_modules/" + name):
                    verify_installed(payload, ROOT / filename)
            original = reference["node_modules/" + name]
            require(original["version"] == record["package"]["version"] and original["integrity"] == record["registryIntegrity"], "Independent reference graph must retain the original registry identity")
        else:
            IO.write_regular(target, payload)
        print(json.dumps({"archive": str(target.relative_to(ROOT)), "originalFiles": len(record["files"]), "integrity": IO.integrity(payload)}))

    builder = IO.regular_bytes(SOURCE / f"upstream/nuxt-vite-builder-{BUILDER_VERSION}.tgz", IO.MAX_COMPRESSED)
    current_builder_files(builder)
    if arguments.check:
        original = reference["node_modules/" + BUILDER_NAME]
        require(original["version"] == BUILDER_VERSION and original["integrity"] == BUILDER_INTEGRITY, "Independent reference graph must retain the official Nuxt builder")
        consumers = [(filename, value) for filename, value in locked.items() if filename.endswith("node_modules/" + BUILDER_NAME)]
        require(bool(consumers), "The official Nuxt builder must have a locked consumer")
        for filename, value in consumers:
            require(value["version"] == BUILDER_VERSION and value["integrity"] == BUILDER_INTEGRITY, "Every Nuxt builder consumer must bind the official archive")
            verify_installed(builder, ROOT / filename)


if __name__ == "__main__":
    main()
