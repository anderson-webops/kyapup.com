import argparse
import base64
import gzip
import hashlib
import io
import json
import os
import stat
import subprocess
import tarfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/rollup-plugins"
VERSIONS = {"@rollup/pluginutils": "5.5.1", "@rollup/plugin-commonjs": "29.0.3", "@rollup/plugin-inject": "5.0.5", "@rollup/plugin-replace": "6.0.3"}
TOOLS = {"esbuild": "0.28.2", "estree-walker": "3.0.3", "magic-string": "1.4.5", "is-reference": "3.0.3"}
ALIASES = {
    "@rollup/pluginutils": {"package/./dist/cjs/index.js": {"path": "package/dist/cjs/index.js", "sha256": "dccad2a2ce1a1dee62b707f659c0589d24620147d436d8e6619969b9c3ea65c4"}},
    "@rollup/plugin-commonjs": {"package/./dist/cjs/index.js": {"path": "package/dist/cjs/index.js", "sha256": "31590d3a49c3e6df7812823f742ee980532bd7cdef8b8b26bff2a68103128fd1"}},
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def archive_files(data, aliases=None):
    require(len(data) <= 1024 * 1024, "Compressed archive exceeds its bound")
    files = {}
    seen = set()
    total = 0
    duplicates = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            name = member.name
            require(name not in seen, "Duplicate archive member")
            seen.add(name)
            known = aliases and name in aliases
            require(known or ((name.startswith("package/") or (name == "package" and member.isdir())) and not PurePosixPath(name).is_absolute() and not any(part in {"", ".", ".."} for part in name.rstrip("/").split("/"))), "Archive member must remain inside package")
            require(member.isfile() or member.isdir(), "Only regular files and directories are accepted")
            if member.isdir():
                continue
            total += member.size
            require(total <= 2 * 1024 * 1024, "Archive payload exceeds its bound")
            payload = archive.extractfile(member).read()
            if known:
                duplicates[name] = payload
            else:
                files[name] = payload
    require(set(duplicates) == set(aliases or {}), "Missing reviewed identical publisher alias")
    for name, payload in duplicates.items():
        expected = aliases[name]
        require(files.get(expected["path"]) == payload and hashlib.sha256(payload).hexdigest() == expected["sha256"], "Publisher alias must match its exact canonical bytes")
    require({"package/package.json", "package/dist/cjs/index.js", "package/dist/es/index.js", "package/types/index.d.ts"} <= files.keys(), "Required upstream entrypoint or types is missing")
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
    require(source.count(original) == 1, "Changed upstream integration anchor requires review: " + original)
    return source.replace(original, replacement)


def rebuild_tools():
    result = subprocess.run([os.environ.get("NODE_BINARY", "node"), str(ROOT / "scripts/rebuild-rollup-tools.mjs")], cwd=ROOT, capture_output=True, check=True, timeout=30)
    require(len(result.stdout) <= 2 * 1024 * 1024, "Compiled tools output exceeds its bound")
    return json.loads(result.stdout)


def build_archive(data, name, record, bundle):
    require(record["schemaVersion"] == 1 and record["tools"] == TOOLS and record["target"] == "node22", "Review changed tool profile")
    require(set(record["packages"]) == set(VERSIONS), "Review changed package cohort")
    info = record["packages"][name]
    require(integrity(data) == info["integrity"], "Upstream archive integrity mismatch")
    require(info.get("canonicalAliases", {}) == ALIASES.get(name, {}), "Review changed original alias declarations")
    files = archive_files(data, ALIASES.get(name))
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata["name"] == name and metadata["version"] == info["version"] == VERSIONS[name], "Unexpected upstream identity")
    require(metadata["license"] == "MIT" and info["patchedVersion"] == info["version"] + "-webops.1", "Preserve the reviewed distribution identity")
    if name == "@rollup/plugin-inject":
        supplement = record["licenseSupplement"]
        require(supplement["path"] == "ROLLUP-LICENSE" and supplement["sha256"] == "7b8136f76c483d03597500bfa991aae9be68d4629e1121cbf9b93aa727efe305", "Review changed root license supplement")
        license_data = (SOURCE / supplement["path"]).read_bytes()
        require(hashlib.sha256(license_data).hexdigest() == supplement["sha256"] and "package/LICENSE" not in files, "Root license identity mismatch")
        require(b"[LICENSE (MIT)](/LICENSE)" in files["package/README.md"], "Review changed original license reference")
        files["package/LICENSE"] = license_data
    else:
        require("package/LICENSE" in files, "Preserve the original package license")
    expected = {"@rollup/pluginutils": "5.5.1-webops.1"} if name != "@rollup/pluginutils" else {}
    if name != "@rollup/plugin-replace":
        require(metadata["dependencies"]["estree-walker"] == "^2.0.2", "Review changed original walker range")
        expected["estree-walker"] = "3.0.3"
    if name == "@rollup/pluginutils":
        expected.update({"magic-string": "1.4.5", "is-reference": "3.0.3"})
    else:
        require(metadata["dependencies"]["magic-string"] == "^0.30.3" and metadata["dependencies"]["@rollup/pluginutils"] == "^5.0.1", "Review changed original parent dependencies")
        expected["magic-string"] = "1.4.5"
    if name in {"@rollup/plugin-commonjs", "@rollup/plugin-inject"}:
        if name == "@rollup/plugin-commonjs":
            require(metadata["dependencies"]["is-reference"] == "1.2.1", "Review changed original reference API")
        else:
            require("is-reference" not in metadata["dependencies"], "Review changed original inline reference API")
        expected["is-reference"] = "3.0.3"
    require(info["dependencies"] == expected, "Review changed maintained dependencies")
    metadata["version"] = info["patchedVersion"]
    metadata["private"] = True
    metadata["engines"]["node"] = "^22.18.0 || >=24.11.0"
    metadata["dependencies"].update(expected)
    require(set(metadata["exports"]) == {"types", "import", "default"}, "Review changed original exports")
    require("package/types/index.d.mts" not in files, "Reserved ESM declaration member already exists")
    files["package/types/index.d.mts"] = files["package/types/index.d.ts"]
    metadata["exports"] = {
        "import": {"types": "./types/index.d.mts", "default": metadata["exports"]["import"]},
        "require": {"types": metadata["exports"]["types"], "default": metadata["exports"]["default"]},
        "default": metadata["exports"]["default"],
    }
    code = files["package/dist/cjs/index.js"].decode()
    bridge = "./webops-tools.cjs" if name == "@rollup/pluginutils" else "@rollup/pluginutils/webops-tools.cjs"
    if name != "@rollup/plugin-replace":
        code = replace_once(code, "require('estree-walker')", "require('" + bridge + "')")
    if name != "@rollup/pluginutils":
        code = replace_once(code, "require('magic-string')", "require('" + bridge + "').MagicString")
    if name == "@rollup/plugin-commonjs":
        code = replace_once(code, "require('is-reference')", "require('" + bridge + "').isReference")
        code = replace_once(code, 'var version = "29.0.2";', 'var version = "29.0.3-webops.1";')
        files["package/dist/es/index.js"] = replace_once(files["package/dist/es/index.js"].decode(), 'var version = "29.0.2";', 'var version = "29.0.3-webops.1";').encode()
    if name == "@rollup/plugin-inject":
        begin = "var isReference = function (node, parent) {"
        end = "var flatten = function (startNode) {"
        for filename, module in [("package/dist/cjs/index.js", code), ("package/dist/es/index.js", files["package/dist/es/index.js"].decode())]:
            require(module.count(begin) == module.count(end) == 1 and module.index(begin) < module.index(end), "Review changed inline reference boundaries")
            declaration = "var isReference = require('" + bridge + "').isReference;\n\n" if "/cjs/" in filename else "import isReference from 'is-reference';\n\n"
            updated = module[:module.index(begin)] + declaration + module[module.index(end):]
            if "/cjs/" in filename:
                code = updated
            else:
                files[filename] = updated.encode()
    files["package/dist/cjs/index.js"] = code.encode()
    if name == "@rollup/pluginutils":
        metadata["exports"] = {".": metadata["exports"], "./webops-tools.cjs": "./dist/cjs/webops-tools.cjs"}
        for filename in ["package/dist/cjs/webops-tools.cjs", "package/WEBOPS-THIRD-PARTY-LICENSES.json"]:
            require(filename not in files, "Reserved tools member already exists")
        files["package/dist/cjs/webops-tools.cjs"] = bundle["code"].encode()
        files["package/WEBOPS-THIRD-PARTY-LICENSES.json"] = (json.dumps(bundle["licenses"], indent=2) + "\n").encode()
    for filename in ["package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"]:
        require(filename not in files, "Reserved provenance member already exists")
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps({"name": name, "original": info, "tools": record["tools"], "adaptation": record["adaptation"]}, indent=2) + "\n").encode()
    return pack_files(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    record = json.loads((SOURCE / "UPSTREAM.json").read_text())
    bundle = rebuild_tools()
    lock = json.loads((ROOT / "package-lock.json").read_text()) if args.check else None
    originals = json.loads((SOURCE / "upstream/package-lock.json").read_text())["packages"] if args.check else None
    for name, info in record["packages"].items():
        expected = "rollup-" + name.split("/")[1] + "-" + info["version"] + ".tgz"
        require(info["archive"] == expected, "Unexpected original archive path")
        original = SOURCE / "upstream" / expected
        require(stat.S_ISREG(original.lstat().st_mode), "Original archive must be a regular file")
        output = build_archive(original.read_bytes(), name, record, bundle)
        target = ROOT / "vendor" / ("rollup-" + name.split("/")[1] + "-" + info["patchedVersion"] + ".tgz")
        if args.check:
            require(stat.S_ISREG(target.lstat().st_mode) and target.read_bytes() == output, "Maintained archive does not reproduce")
            consumers = [(location, metadata) for location, metadata in lock["packages"].items() if location.endswith("/" + name)]
            require(bool(consumers), "Every maintained package must have a locked consumer")
            for location, metadata in consumers:
                require(metadata["version"] == info["patchedVersion"] and metadata["integrity"] == integrity(output), "Consuming lock identity mismatch")
                for filename, data in archive_files(output).items():
                    require((ROOT / location / filename.removeprefix("package/")).read_bytes() == data, "Installed bytes do not match the accepted archive")
            require(originals["node_modules/" + name]["version"] == info["version"] and originals["node_modules/" + name]["integrity"] == info["integrity"], "Original-version auditing must retain official identities")
        else:
            require(not target.is_symlink(), "Maintained output must remain local")
            target.write_bytes(output)
    print("Four maintained Rollup archives " + ("verified" if args.check else "reproduced"))


if __name__ == "__main__":
    main()
