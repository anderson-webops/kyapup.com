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
SOURCE = ROOT / "vendor/magicast"
TARGET = ROOT / "vendor/magicast-0.5.5-webops.1.tgz"
DEPENDENCIES = {"@babel/generator": "^8.1.0", "@babel/parser": "^8.1.0", "@babel/types": "^8.1.0", "source-map-js": "^1.2.2"}
BUNDLE = "package/dist/builders-CDdrUKLb.js"


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
            require(total <= 4 * 1024 * 1024, "Archive payload exceeds its bound")
            files[name] = archive.extractfile(member).read()
    require({"package/package.json", "package/LICENSE", BUNDLE, "package/dist/index.js", "package/dist/core.js", "package/dist/helpers.js", "package/dist/index.d.ts"} <= files.keys(), "Required upstream module, types or license is missing")
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
    require(source.count(original) == 1, "Changed upstream integration anchor requires review: " + original[:80])
    return source.replace(original, replacement)


def build_archive(data, upstream, bridge):
    require(upstream["schemaVersion"] == 1 and integrity(data) == upstream["integrity"], "Upstream archive integrity mismatch")
    files = archive_files(data)
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata["name"] == upstream["name"] == "magicast" and metadata["version"] == upstream["version"] == "0.5.5", "Unexpected upstream identity")
    require(metadata["license"] == "MIT" and upstream["patchedVersion"] == "0.5.5-webops.1", "Preserve the reviewed distribution identity")
    require(upstream["dependencies"] == DEPENDENCIES, "Use the qualified compiler contract")
    require(metadata["inlinedDependencies"] == {"recast": "0.24.0", "source-map-js": "1.2.1"} and upstream["inlinedDependencies"] == {**metadata["inlinedDependencies"], "ast-types": "0.16.3"}, "Review changed inlined dependency identities")
    source = files[BUNDLE].decode()
    source = 'import { extendBabel8Types, nativeLiteralBuilders, printBabel8Node } from "./babel8.js";\nimport * as currentSourceMap from "source-map-js";\n' + source
    source = replace_once(source, "\tplugins.forEach(fork.use);\n\ttypes.finalize();", "\tplugins.forEach(fork.use);\n\textendBabel8Types(types);\n\ttypes.finalize();")
    begin = "//#region node_modules/.pnpm/source-map-js@1.2.1/node_modules/source-map-js/lib/base64.js"
    end = "//#region vendor/recast/lib/util.ts"
    require(source.count(begin) == source.count(end) == 1, "Review changed source-map boundaries")
    first, last = source.index(begin), source.index(end)
    require(first < last, "Source-map boundaries are reordered")
    source = source[:first] + source[last:]
    source = replace_once(source, 'var import_source_map = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports) => {\n\texports.SourceMapGenerator = require_source_map_generator().SourceMapGenerator;\n\texports.SourceMapConsumer = require_source_map_consumer().SourceMapConsumer;\n\texports.SourceNode = require_source_node().SourceNode;\n})))());', 'const import_source_map = currentSourceMap;')
    source = replace_once(source, '\tnamedTypes.Printable.assert(n);\n\tconst parts = [];', '\tnamedTypes.Printable.assert(n);\n\tconst modern = printBabel8Node(n, options);\n\tif (modern !== null) return fromString(modern, options);\n\tconst parts = [];')
    for option in ('decimal', 'importAssertions', 'recordAndTuple'):
        if option == 'recordAndTuple':
            source = replace_once(source, '\t\t\t["recordAndTuple", { syntaxType: "hash" }],\n', '')
        else:
            source = replace_once(source, f'\t\t\t"{option}",\n', '')
    source = replace_once(source, '\t\t\t["pipelineOperator", { proposal: "minimal" }],\n', '')
    source = replace_once(source, '\t\tif (hasOwn$4.call(types, parameter.name)) types[parameter.name].push(parameterPath);\n\t\telse types[parameter.name] = [parameterPath];', '\t\tconst name = typeof parameter.name === "string" ? parameter.name : parameter.name.name;\n\t\tif (hasOwn$4.call(types, name)) types[name].push(parameterPath);\n\t\telse types[name] = [parameterPath];')
    source = replace_once(source, '\tif (value === null) return b$5.literal(null);', '\tif (value === null) return b$5.literal(null);\n\tif (typeof value === "bigint") return b$5.bigIntLiteral(value);')
    source = replace_once(source, 'const b$5 = builders$1;', 'const b$5 = nativeLiteralBuilders;')
    source = replace_once(source, 'delete regex.extra.raw;', 'delete regex.extra?.raw;')
    source = replace_once(source, 'if (LITERALS_AST.has(node.type)) return node.value;', 'if (LITERALS_AST.has(node.type)) return node.type === "NullLiteral" ? null : node.value;')
    source = replace_once(source, '\t\tcase "CallExpression":\n\t\t\tproxy = proxifyFunctionCall(node, mod);', '\t\tcase "ImportExpression":\n\t\t\tproxy = proxifyImportExpression(node, mod);\n\t\t\tbreak;\n\t\tcase "CallExpression":\n\t\t\tproxy = proxifyFunctionCall(node, mod);')
    source = replace_once(source, 'function proxifyFunctionCall(node, mod) {', r'''function proxifyImportExpression(node, mod) {
    const values = [];
    function refresh() {
        values.length = node.options ? 2 : 1;
        values[0] = node.source;
        if (node.options) values[1] = node.options;
    }
    const argumentsView = new Proxy(values, {
        get(target, key, receiver) {
            refresh();
            return Reflect.get(target, key, receiver);
        },
        set(target, key, value) {
            refresh();
            if ((key === "length" && value > 2) || (/^\\d+$/.test(String(key)) && Number(key) > 1)) throw new RangeError("Dynamic imports accept at most two arguments");
            Reflect.set(target, key, value);
            node.source = target[0];
            node.options = target[1] || null;
            return true;
        },
        deleteProperty(target, key) {
            refresh();
            Reflect.deleteProperty(target, key);
            node.source = target[0];
            node.options = target[1] || null;
            return true;
        }
    });
    return createProxy(node, { $type: "function-call", $callee: "import", $args: proxifyArrayElements(node, argumentsView, mod) }, {});
}
function proxifyFunctionCall(node, mod) {''')
    helpers = files["package/dist/helpers.js"].decode()
    for expression in ('generateCode(configObject).code', 'generateCode(builders.functionCall(declaration.init.callee.name, configObject)).code', 'generateCode(builders.functionCall(declaration.init.expression.callee.name, configObject)).code'):
        expected = 2 if expression == 'generateCode(configObject).code' else 1
        require(helpers.count(expression) == expected, "Review changed config declaration assignment")
        helpers = helpers.replace(expression, f'parseExpression({expression}).$ast')
    files["package/dist/helpers.js"] = helpers.encode()
    metadata.update({"version": upstream["patchedVersion"], "private": True, "engines": {"node": "^22.18.0 || >=24.11.0"}, "dependencies": DEPENDENCIES, "inlinedDependencies": {"recast": "0.24.0", "ast-types": "0.16.3"}})
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    files[BUNDLE] = source.encode()
    files["package/dist/babel8.js"] = bridge
    require("package/UPSTREAM-PACKAGE.json" not in files and "package/WEBOPS-COMPAT.json" not in files, "Reserved provenance member already exists")
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(upstream, indent=2) + "\n").encode()
    return pack_files(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    upstream = json.loads((SOURCE / "UPSTREAM.json").read_text())
    require(upstream["archive"] == "upstream/magicast-0.5.5.tgz", "Use the reviewed local upstream archive")
    filename = SOURCE / upstream["archive"]
    bridge = SOURCE / "babel8.js"
    require(stat.S_ISREG(filename.lstat().st_mode) and stat.S_ISREG(bridge.lstat().st_mode), "Inputs must be regular files")
    archive = build_archive(filename.read_bytes(), upstream, bridge.read_bytes())
    if arguments.check:
        require(stat.S_ISREG(TARGET.lstat().st_mode) and TARGET.read_bytes() == archive, "Compatibility archive does not reproduce")
        lock = json.loads((ROOT / "package-lock.json").read_text())["packages"]
        consumers = [metadata for name, metadata in lock.items() if name.endswith("/magicast")]
        require(bool(consumers), "The maintained configuration editor must have a locked consumer")
        for consumer in consumers:
            require(consumer["version"] == upstream["patchedVersion"] and consumer["integrity"] == integrity(archive), "Every consuming lock must bind the qualified archive")
        original_lock = json.loads((SOURCE / "upstream/package-lock.json").read_text())["packages"]
        original = original_lock["node_modules/magicast"]
        require(original["version"] == upstream["version"] and original["integrity"] == upstream["integrity"], "Original-version auditing must retain the official identity")
        for name, version in {**upstream["inlinedDependencies"], "source-map-js": "1.2.2"}.items():
            require(original_lock["node_modules/" + name]["version"] == version, "Audit the exact inlined dependency identity")
        print("Configuration editor archive reproduces; original types/license and independent inlined-version audit identities are preserved.")
    else:
        require(not TARGET.is_symlink(), "Compatibility output must remain local")
        TARGET.write_bytes(archive)
        print(json.dumps({"archive": str(TARGET.relative_to(ROOT)), "integrity": integrity(archive)}))


if __name__ == "__main__":
    main()
