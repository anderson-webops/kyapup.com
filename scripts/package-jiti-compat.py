import argparse
import importlib.util
import json
import stat
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/watchers"
TARGET = ROOT / "vendor/jiti-2.7.0-webops.1.tgz"
SPEC = importlib.util.spec_from_file_location("bounded_archives", ROOT / "scripts/package-nft-compat.py")
ARCHIVES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARCHIVES)
ANCHORS = [
    ("e.opts.tryNative&&!e.opts.transformOptions", "e.opts.tryNative&&e.opts.moduleCache&&!e.opts.transformOptions"),
    ("S=n.forceTranspile??(!C&&!(w&&n.async)&&(E||w||t.isTransformRe.test(c)||hasESMSyntax(i)))", "S=n.forceTranspile??(!t.opts.moduleCache||(!C&&!(w&&n.async)&&(E||w||t.isTransformRe.test(c)||hasESMSyntax(i))))"),
    ('debug(e,"[json]",a);const t=e.nativeRequire(a);', 'debug(e,"[json]",a);const t=e.opts.moduleCache?e.nativeRequire(a):JSON.parse((0,$e.readFileSync)(a,"utf8").replace(/^\\uFEFF/,""));'),
    (",I=Ci.performance.now();if(S)", ",isNativeCommonJS=C||(!w&&!E&&!hasESMSyntax(i)),I=Ci.performance.now();if(S)"),
    ("B=j(N.exports,N.require,N,N.filename,pathe_M_eThtNZ_dirname(N.filename),O.import,O.esmResolve)", "B=j.call(!t.opts.moduleCache&&isNativeCommonJS?N.exports:void 0,N.exports,N.require,N,N.filename,pathe_M_eThtNZ_dirname(N.filename),O.import,O.esmResolve)"),
]


def build_archive(data, record):
    ARCHIVES.require(record["name"] == "jiti" and record["version"] == "2.7.0" and record["patchedVersion"] == "2.7.0-webops.1", "Review changed maintained loader identity")
    ARCHIVES.require(ARCHIVES.integrity(data) == record["integrity"], "Original loader integrity mismatch")
    files = ARCHIVES.archive_files(data)
    original = files["package/package.json"]
    metadata = json.loads(original)
    ARCHIVES.require(metadata["name"] == record["name"] and metadata["version"] == record["version"] and metadata["license"] == "MIT", "Original loader identity mismatch")
    code = files["package/dist/jiti.cjs"].decode()
    for before, after in ANCHORS:
        code = ARCHIVES.replace_once(code, before, after)
    metadata["version"] = record["patchedVersion"]
    metadata["private"] = True
    files["package/package.json"] = (json.dumps(metadata, indent=2) + "\n").encode()
    files["package/dist/jiti.cjs"] = code.encode()
    for name in ["package/UPSTREAM-PACKAGE.json", "package/WEBOPS-COMPAT.json"]:
        ARCHIVES.require(name not in files, "Reserved provenance member already exists")
    files["package/UPSTREAM-PACKAGE.json"] = original
    files["package/WEBOPS-COMPAT.json"] = (json.dumps(record, indent=2) + "\n").encode()
    return ARCHIVES.pack_files(files, executable_paths=("package/lib/jiti-cli.mjs",))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    record = json.loads((SOURCE / "UPSTREAM.json").read_text())["jiti"]
    ARCHIVES.require(record["archive"] == "jiti-2.7.0.tgz", "Review changed original path")
    source = SOURCE / "upstream" / record["archive"]
    ARCHIVES.require(stat.S_ISREG(source.lstat().st_mode), "Original input must be a regular file")
    output = build_archive(source.read_bytes(), record)
    if args.check:
        ARCHIVES.require(stat.S_ISREG(TARGET.lstat().st_mode) and TARGET.read_bytes() == output, "Maintained loader does not reproduce")
        packages = json.loads((ROOT / "package-lock.json").read_text())["packages"]
        consumers = [(location, info) for location, info in packages.items() if location.endswith("/jiti")]
        ARCHIVES.require(bool(consumers), "A locked loader consumer is required")
        for location, info in consumers:
            ARCHIVES.require(info["version"] == record["patchedVersion"] and info["integrity"] == ARCHIVES.integrity(output), "Consuming loader integrity mismatch")
            for name, data in ARCHIVES.archive_files(output).items():
                filename = ROOT / location / name.removeprefix("package/")
                ARCHIVES.require(stat.S_ISREG(filename.lstat().st_mode) and filename.read_bytes() == data, "Installed loader bytes mismatch")
    else:
        ARCHIVES.require(not TARGET.is_symlink(), "Output must remain local")
        TARGET.write_bytes(output)
    print("Maintained cache-policy loader " + ("verified" if args.check else "reproduced"))


if __name__ == "__main__":
    main()
