import argparse
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/schema-parents"
SPEC = importlib.util.spec_from_file_location("framework_package_io", ROOT / "scripts/package-framework-parents.py")
ARCHIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARCHIVE)
IO = ARCHIVE.IO
ESLINT_FACTORY = '''module.exports = (additionalOptions = {}) => {
\tconst { nullable = false, ...nativeOptions } = additionalOptions;
\tconst ajv = new Ajv({
\t\tuseDefaults: true,
\t\tvalidateSchema: false,
\t\tverbose: true,
\t\tstrict: false,
\t\t...nativeOptions,
\t\tallowNullable: nullable,
\t});
\tif (!nullable) ajv.removeKeyword("nullable");
\taddFormats(ajv, { mode: "fast" });
\treturn ajv;
};'''
ORIGINAL_ESLINT_FACTORY = '''module.exports = (additionalOptions = {}) => {
\tconst ajv = new Ajv({
\t\tmeta: false,
\t\tuseDefaults: true,
\t\tvalidateSchema: false,
\t\tmissingRefs: "ignore",
\t\tverbose: true,
\t\tschemaId: "auto",
\t\t...additionalOptions,
\t});

\tajv.addMetaSchema(metaSchema);
\t// eslint-disable-next-line no-underscore-dangle -- Ajv's API
\tajv._opts.defaultMeta = metaSchema.id;

\treturn ajv;
};'''
PACKAGES = {
    "ajv": {
        "version": "8.20.0",
        "revision": 2,
        "count": 466,
        "before": {"fast-uri": "^3.0.1"},
        "after": {"fast-uri": "^4.2.3"},
        "required": {"LICENSE", "dist/ajv.js", "dist/ajv.d.ts", "dist/core.js", "lib/ajv.ts"},
        "replacements": [
            {"file": "lib/core.ts", "before": "  allowUnionTypes?: boolean\n", "after": "  allowUnionTypes?: boolean\n  allowNullable?: boolean\n"},
            {"file": "dist/core.d.ts", "before": "    allowUnionTypes?: boolean;\n", "after": "    allowUnionTypes?: boolean;\n    allowNullable?: boolean;\n"},
            {"file": "lib/compile/validate/dataType.ts", "before": "getSchemaTypes(schema: AnySchemaObject): JSONType[] {", "after": "getSchemaTypes(schema: AnySchemaObject, allowNullable = true): JSONType[] {\n  const nullable = allowNullable ? schema.nullable : undefined"},
            {"file": "lib/compile/validate/dataType.ts", "before": "if (schema.nullable === false)", "after": "if (nullable === false)"},
            {"file": "lib/compile/validate/dataType.ts", "before": "!types.length && schema.nullable !== undefined", "after": "!types.length && nullable !== undefined"},
            {"file": "lib/compile/validate/dataType.ts", "before": "if (schema.nullable === true)", "after": "if (nullable === true)"},
            {"file": "dist/compile/validate/dataType.d.ts", "before": "getSchemaTypes(schema: AnySchemaObject): JSONType[];", "after": "getSchemaTypes(schema: AnySchemaObject, allowNullable?: boolean): JSONType[];"},
            {"file": "lib/compile/validate/index.ts", "before": "const types = getSchemaTypes(it.schema)", "after": "const types = getSchemaTypes(it.schema, it.opts.allowNullable !== false)"},
        ],
        "compiledSources": ["lib/core.ts", "lib/compile/validate/dataType.ts", "lib/compile/validate/index.ts"],
    },
    "postcss": {
        "version": "8.5.32",
        "revision": 1,
        "count": 55,
        "before": {"nanoid": "^3.3.20"},
        "after": {"nanoid": "^6.0.2"},
        "required": {"LICENSE", "lib/postcss.js", "lib/postcss.d.ts", "lib/input.js", "lib/input.d.ts"},
        "originalNode": "^10 || ^12 || >=14",
        "qualifiedNode": "^26.13.0",
    },
    "eslint": {
        "version": "10.14.0",
        "revision": 2,
        "count": 421,
        "before": {"ajv": "^6.14.0"},
        "after": {"ajv": "^8.20.0", "ajv-draft-04": "^1.0.0", "ajv-formats": "^3.0.1"},
        "required": {"LICENSE", "bin/eslint.js", "lib/api.js", "lib/shared/ajv.js", "lib/config/config.js", "lib/types/index.d.ts"},
        "replacements": [
            {
                "file": "lib/shared/ajv.js",
                "before": 'const Ajv = require("ajv"),\n\tmetaSchema = require("ajv/lib/refs/json-schema-draft-04.json");',
                "after": 'const Ajv = require("ajv-draft-04"),\n\taddFormats = require("ajv-formats");',
            },
            {"file": "lib/shared/ajv.js", "before": ORIGINAL_ESLINT_FACTORY, "after": ESLINT_FACTORY},
        ],
    },
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def original_archive(name):
    return "upstream/" + name + "-" + PACKAGES[name]["version"] + ".tgz"


def maintained_version(name):
    return PACKAGES[name]["version"] + "+webops." + str(PACKAGES[name]["revision"])


def maintained_archive(name):
    return name + "-" + maintained_version(name).replace("+", "-") + ".tgz"


def build_archive(payload, record):
    name = record["package"]["name"]
    require(name in PACKAGES, "Unreviewed schema parent")
    policy = PACKAGES[name]
    require(record["schemaVersion"] == 1, "Unsupported original-parent schema")
    require(record["archive"] == original_archive(name), "Use the exact original archive path")
    require(record["patchedVersion"] == maintained_version(name), "Use the reviewed maintained source identity")
    require(record["registryIntegrity"] == IO.integrity(payload), "Original registry integrity differs")
    require(record["registryArchiveSha256"] == hashlib.sha256(payload).hexdigest(), "Original archive digest differs")
    files, modes = ARCHIVE.archive_files(payload)
    require(len(files) == policy["count"], "The complete original inventory changed")
    require({"package/package.json", *("package/" + filename for filename in policy["required"])} <= files.keys(), "Required source, entrypoint, type or license is missing")
    require(set(files) == {"package/" + filename for filename in record["files"]}, "Complete original source paths changed")
    for filename, payload_bytes in files.items():
        original = record["files"][filename.removeprefix("package/")]
        require(original == {"sha256": hashlib.sha256(payload_bytes).hexdigest(), "mode": modes[filename]}, "Original source bytes or permissions changed")
    original_metadata = files["package/package.json"]
    metadata = json.loads(original_metadata)
    require(metadata == record["package"], "Original package metadata changed")
    require(metadata["version"] == policy["version"] and metadata["license"] == "MIT", "Preserve the original version and license")
    for dependency, version in policy["before"].items():
        require(metadata["dependencies"][dependency] == version, "Original dependency contract changed")
    for dependency in policy["after"].keys() - policy["before"].keys():
        require(dependency not in metadata["dependencies"], "New provider contract requires fresh review")
    for command in metadata.get("bin", {}).values():
        filename = "package/" + command.removeprefix("./")
        require(filename in files and modes[filename] == 0o755, "Required CLI must retain executable mode")
    for change in policy.get("replacements", []):
        filename = "package/" + change["file"]
        require(files[filename].count(change["before"].encode()) == 1, "Reviewed source replacement no longer matches")
        files[filename] = files[filename].replace(change["before"].encode(), change["after"].encode())
    if "compiledSources" in policy:
        sources = {filename: files["package/" + filename].decode() for filename in policy["compiledSources"]}
        compiled = subprocess.run(
            ["node", "--max-old-space-size=256", str(ROOT / "scripts/compile-schema-source.mjs")],
            input=json.dumps(sources), capture_output=True, text=True, timeout=60, check=True,
        )
        require(len(compiled.stdout.encode()) <= 2 * 1024 * 1024, "Compiled output exceeds its bound")
        outputs = json.loads(compiled.stdout)
        expected = {filename.replace("lib/", "dist/", 1).removesuffix(".ts") + suffix for filename in sources for suffix in [".js", ".js.map"]}
        require(set(outputs) == expected, "Only declared CommonJS modules and source maps may be emitted")
        for filename, contents in outputs.items():
            require("package/" + filename in files and isinstance(contents, str), "Generated output must replace a declared original file")
            files["package/" + filename] = contents.encode()
    if "qualifiedNode" in policy:
        require(metadata["engines"]["node"] == policy["originalNode"], "Original runtime contract changed")
        metadata["engines"]["node"] = policy["qualifiedNode"]
    metadata["version"] = maintained_version(name)
    metadata["private"] = True
    metadata["dependencies"].update(policy["after"])
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    for filename, contents in {
        "package/UPSTREAM-PACKAGE.json": original_metadata,
        "package/WEBOPS-SCHEMA.json": (json.dumps(record, indent=2) + "\n").encode(),
    }.items():
        require(filename not in files, "Reserved source-provenance member already exists")
        files[filename] = contents
        modes[filename] = 0o644
    return ARCHIVE.pack_files(files, modes)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    records = json.loads(IO.regular_bytes(SOURCE / "UPSTREAM.json", 1024 * 1024))
    require(set(records) == set(PACKAGES), "All reviewed schema/identifier parents are required")
    locked = json.loads(IO.regular_bytes(ROOT / "package-lock.json", 8 * 1024 * 1024))["packages"] if arguments.check else None
    reference = json.loads(IO.regular_bytes(SOURCE / "upstream/package-lock.json", 8 * 1024 * 1024))["packages"] if arguments.check else None
    for name, record in records.items():
        require(record["package"]["name"] == name and record["archive"] == original_archive(name), "Validate exact identity and path before opening input")
        payload = build_archive(IO.regular_bytes(SOURCE / record["archive"], IO.MAX_COMPRESSED), record)
        target = ROOT / "vendor" / maintained_archive(name)
        if arguments.check:
            require(IO.regular_bytes(target, IO.MAX_COMPRESSED) == payload, "Maintained archive does not reproduce")
            consumers = [(filename, value) for filename, value in locked.items() if filename.endswith("node_modules/" + name)]
            require(bool(consumers), "Maintained parent has no actual consumer")
            for filename, metadata in consumers:
                require(metadata["version"] == maintained_version(name) and metadata["integrity"] == IO.integrity(payload), "Every consumer must bind the qualified parent")
                ARCHIVE.verify_installed(payload, ROOT / filename)
            original = reference["node_modules/" + name]
            require(original["version"] == record["package"]["version"] and original["integrity"] == record["registryIntegrity"], "The independent comparison must retain its original identity")
        else:
            IO.write_regular(target, payload)
        print(json.dumps({"archive": str(target.relative_to(ROOT)), "originalFiles": len(record["files"]), "integrity": IO.integrity(payload)}))


if __name__ == "__main__":
    main()
