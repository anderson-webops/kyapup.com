import argparse
import base64
import gzip
import hashlib
import io
import json
import re
import stat
import subprocess
import tarfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/vue-compiler"
VERSION = "3.5.45-webops.1"
DEPENDENCIES = {"@babel/parser": "8.1.0", "estree-walker": "3.0.3", "magic-string": "1.4.5"}
BROWSER_TOOLS = {"@babel/parser": "8.1.0", "esbuild": "0.28.2", "estree-walker": "3.0.3", "magic-string": "1.4.5"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integrity(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def archive_files(data):
    require(len(data) <= 8 * 1024 * 1024, "Compressed archive exceeds its bound")
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
    require({"package/package.json", "package/LICENSE", "package/README.md"} <= files.keys(), "Required original identity or license is missing")
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


def replace_exact(source, original, replacement, count=1):
    require(source.count(original) == count, "Changed compiler integration anchor requires review: " + original[:90])
    return source.replace(original, replacement)


def modernize_sfc(source):
    require(source.count("node.typeParameters") == 46, "Review changed generic argument callers")
    source = source.replace("node.typeParameters", "node.typeArguments")
    source = replace_exact(source, "types[node.id.name] = node.typeArguments ? node : node.typeAnnotation;", "types[node.id.name] = node.typeParameters ? node : node.typeAnnotation;")
    source = replace_exact(source, 'case "TSExpressionWithTypeArguments":', 'case "TSInterfaceHeritage":')
    source = replace_exact(source, 'node.type === "TSExpressionWithTypeArguments"', 'node.type === "TSInterfaceHeritage"')
    source = replace_exact(source, "typeParameters[p.name]", "typeParameters[p.name.name]")
    source = replace_exact(source, "typeParams[p.name]", "typeParams[p.name.name]", 2)
    source = replace_exact(source, "getId(node.argument)", "getId(node.source)")
    source = replace_exact(source, "node.argument.value", "node.source.value", 2)
    source, count = re.subn(r"(ctx,\s+)node\.argument,(\s+scope,\s+node\.source\.value)", r"\1node.source,\2", source)
    require(count == 2, "Review changed imported type resolution")
    source = replace_exact(source, "node.parameters[0]", "node.params[0]")
    source = replace_exact(source, "call.parameters[0]", "call.params[0]")
    source = replace_exact(source, "return (_a = resolved.typeAnnotation) == null ? void 0 : _a.typeAnnotation;", "return (_a = resolved.returnType) == null ? void 0 : _a.typeAnnotation;")
    source = replace_exact(source, "existing.members.push(...node.members);", "existing.body.members.push(...node.body.members);")
    source = replace_exact(source, "for (const m of node.members) {", "for (const m of node.body.members) {")
    source = replace_exact(source, "isAllLiteral = node.members.every(", "isAllLiteral = node.body.members.every(")
    source = replace_exact(source, 'node.type === "TSModuleDeclaration" && node.global', 'node.type === "TSModuleDeclaration" && node.kind === "global"')
    source = replace_exact(source, "const { name, constraint } = node.typeParameter;", "const name = node.key.name;\n    const constraint = node.constraint;")
    source = replace_exact(source, "node.typeParameter.constraint", "node.constraint")
    source = replace_exact(source, "const { typeAnnotation, typeParameter } = node;", "const { typeAnnotation, constraint, key } = node;")
    source = replace_exact(source, "&& typeParameter && typeParameter.constraint && typeParameters", "&& constraint && typeParameters")
    source = replace_exact(source, "          const constraint = typeParameter.constraint;\n", "")
    source = replace_exact(source, "index.typeName.name === typeParameter.name", "index.typeName.name === key.name")
    source = replace_exact(source, '    case "TemplateLiteral": {\n      return resolveTemplateKeys(ctx, node, scope);', '    case "TemplateLiteral":\n    case "TSTemplateLiteralType": {\n      return resolveTemplateKeys(ctx, node, scope);')
    source = replace_exact(source, "function resolveTemplateKeys(ctx, node, scope) {\n  if (!node.expressions.length)", "function resolveTemplateKeys(ctx, node, scope) {\n  const expressions = node.type === \"TSTemplateLiteralType\" ? node.types : node.expressions;\n  if (!expressions.length)")
    source = replace_exact(source, "const e = node.expressions[0];", "const e = expressions[0];")
    source = replace_exact(source, "expressions: node.expressions.slice(1),", "...(node.type === \"TSTemplateLiteralType\" ? { types: expressions.slice(1) } : { expressions: expressions.slice(1) }),")
    source = replace_exact(source, "function recordType(node, types, declares, overwriteId) {", '''function recordType(node, types, declares, overwriteId) {
  if (node.type === "TSModuleDeclaration" && node.id.type === "TSQualifiedName") {
    const identifiers = [];
    let identifier = node.id;
    while (identifier.type === "TSQualifiedName") {
      identifiers.unshift(identifier.right);
      identifier = identifier.left;
    }
    identifiers.unshift(identifier);
    let expanded = { ...node, id: identifiers.pop() };
    while (identifiers.length) {
      expanded = { ...node, id: identifiers.pop(), body: { type: "TSModuleBlock", body: [{ type: "ExportNamedDeclaration", declaration: expanded, exportKind: "type", specifiers: [], source: null }] } };
    }
    node = expanded;
  }''')
    return source


def browser_entry(source):
    def remove_region(text, begin, end, include_end=False):
        require(text.count(begin) == text.count(end) == 1, "Review changed embedded dependency boundaries")
        first, last = text.index(begin), text.index(end)
        require(first < last, "Embedded dependency boundaries are reordered")
        return text[:first] + text[last + (len(end) if include_end else 0):]

    source = remove_region(source, "var lib = {};", "var libExports = /*@__PURE__*/ requireLib();", True)
    source = remove_region(source, "class WalkerBase {", "function walkIdentifiers(")
    source = remove_region(source, '// src/vlq.ts\nvar comma = ",".charCodeAt(0);', "var _a, _b;\nclass ScriptCompileContext")
    return 'import * as libExports from "@babel/parser";\nimport {walk as walk$2} from "estree-walker";\nimport MagicString from "magic-string";\n' + modernize_sfc(source)


def build_archive(data, name, upstream, browser_builder):
    info = upstream["packages"][name]
    require(upstream["schemaVersion"] == 1 and integrity(data) == info["integrity"], "Upstream archive integrity mismatch")
    require(upstream["patchedVersion"] == VERSION and upstream["dependencies"] == DEPENDENCIES, "Use the qualified compiler dependency contract")
    require(upstream["browserTools"] == BROWSER_TOOLS and upstream["browserBundler"] == {"esbuild": "0.28.2", "target": "es2022"}, "Review a changed browser tooling profile")
    files = archive_files(data)
    original = files["package/package.json"]
    metadata = json.loads(original)
    require(metadata["name"] == name and metadata["version"] == info["version"] == "3.5.45", "Unexpected upstream identity")
    require(metadata["license"] == "MIT" and metadata["dependencies"]["@babel/parser"] == "^7.29.12", "Review changed original compiler contract")
    module = name.split("/")[1]
    required = {f"package/dist/{module}.cjs.js", f"package/dist/{module}.d.ts"}
    required.add(f"package/dist/{module}.esm-browser.js" if module == "compiler-sfc" else f"package/dist/{module}.cjs.prod.js")
    if module == "compiler-core":
        required.update({"package/index.js", "package/dist/compiler-core.esm-bundler.js"})
    require(required <= files.keys(), "Required original compiler entrypoint is missing")
    metadata.update({"version": VERSION, "private": True, "engines": {"node": "^22.18.0 || >=24.11.0"}})
    metadata["dependencies"].update(DEPENDENCIES)
    metadata["devDependencies"]["@babel/types"] = "^8.1.0"
    licenses = {}
    if module == "compiler-core":
        adapter = browser_builder('import * as parser from "@babel/parser"; export {parser}; export {walk} from "estree-walker"; export {default as MagicString} from "magic-string";', True)
        files["package/dist/webops-compiler-tools.cjs"] = adapter["code"].encode()
        licenses.update(adapter["licenses"])
        tools = "./webops-compiler-tools.cjs"
    else:
        metadata["dependencies"]["@vue/compiler-core"] = VERSION
        tools = "@vue/compiler-core/dist/webops-compiler-tools.cjs"
    for filename in list(files):
        if filename.endswith((".cjs.js", ".cjs.prod.js")):
            source = files[filename].decode()
            source = replace_exact(source, "var estreeWalker = require('estree-walker');", f"var estreeWalker = require('{tools}');")
            if module == "compiler-core":
                source = replace_exact(source, "var parser = require('@babel/parser');", f"var parser = require('{tools}').parser;")
            else:
                source = replace_exact(source, "var parser$2 = require('@babel/parser');", f"var parser$2 = require('{tools}').parser;")
            files[filename] = source.encode()
    if module == "compiler-sfc":
        filename = f"package/dist/{module}.cjs.js"
        source = files[filename].decode()
        source = replace_exact(source, "var MagicString = require('magic-string');", f"var MagicString = require('{tools}').MagicString;")
        files[filename] = modernize_sfc(source).encode()
        filename = f"package/dist/{module}.esm-browser.js"
        browser = browser_builder(browser_entry(files[filename].decode()), False)
        files[filename] = browser["code"].encode()
        licenses.update(browser["licenses"])
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    require("package/UPSTREAM-PACKAGE.json" not in files and "package/WEBOPS-COMPAT.json" not in files, "Reserved provenance member already exists")
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(upstream, indent=2) + "\n").encode()
    require("package/WEBOPS-THIRD-PARTY-LICENSES.json" not in files, "Reserved license member already exists")
    files["package/WEBOPS-THIRD-PARTY-LICENSES.json"] = (json.dumps(licenses, indent=2, sort_keys=True) + "\n").encode()
    return pack_files(files)


def rebuild_browser(source, node_adapter=False):
    command = ["node", str(ROOT / "scripts/rebuild-vue-compiler-browser.mjs")]
    if node_adapter:
        command.append("--node-adapter")
    result = subprocess.run(command, cwd=ROOT, input=source.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60, check=False)
    require(result.returncode == 0, "Standalone browser rebuild failed: " + result.stderr.decode())
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    upstream = json.loads((SOURCE / "UPSTREAM.json").read_text())
    for name, info in upstream["packages"].items():
        module = name.split("/")[1]
        require(info["archive"] == f"upstream/vue-{module}-3.5.45.tgz", "Use the reviewed original archive path")
        filename = SOURCE / info["archive"]
        require(stat.S_ISREG(filename.lstat().st_mode), "Original archive must be a regular file")
        archive = build_archive(filename.read_bytes(), name, upstream, rebuild_browser)
        target = ROOT / f"vendor/vue-{module}-{VERSION}.tgz"
        if arguments.check:
            require(stat.S_ISREG(target.lstat().st_mode) and target.read_bytes() == archive, "Compiler compatibility archive does not reproduce")
            lock = json.loads((ROOT / "package-lock.json").read_text())["packages"]
            consumers = [metadata for key, metadata in lock.items() if key.endswith("/" + name)]
            require(bool(consumers), "Every maintained compiler must have a locked consumer")
            for consumer in consumers:
                require(consumer["version"] == VERSION and consumer["integrity"] == integrity(archive), "Every compiler lock must bind the qualified archive")
            original = json.loads((SOURCE / "upstream/package-lock.json").read_text())["packages"]["node_modules/" + name]
            require(original["version"] == info["version"] and original["integrity"] == info["integrity"], "Original-version audit identity must remain intact")
        else:
            require(not target.is_symlink(), "Compiler archive output must remain local")
            target.write_bytes(archive)
        print(json.dumps({"name": name, "archive": str(target.relative_to(ROOT)), "integrity": integrity(archive), "checked": arguments.check}))


if __name__ == "__main__":
    main()
