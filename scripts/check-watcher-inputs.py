import importlib.util
import json
import stat
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/watchers"
SPEC = importlib.util.spec_from_file_location("archive_inputs", ROOT / "scripts/check-nitro-tool-inputs.py")
INPUTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INPUTS)


def verify_package(info):
    INPUTS.require(info["archive"] == info["name"] + "-" + info["version"] + ".tgz", "Unexpected original archive path")
    original = SOURCE / "upstream" / info["archive"]
    INPUTS.require(stat.S_ISREG(original.lstat().st_mode), "Original archive must be a regular file")
    data = original.read_bytes()
    INPUTS.require(INPUTS.integrity(data) == info["integrity"], "Original archive integrity mismatch")
    files = INPUTS.archive_files(data)
    metadata = json.loads(files["package/package.json"])
    INPUTS.require(metadata["name"] == info["name"] and metadata["version"] == info["version"], "Original package identity mismatch")
    reference = info["version"] == "5.0.0" or info["name"] == "jiti"
    expected = ("vendor/watchers/upstream/node_modules/" if reference else "node_modules/") + info["name"]
    INPUTS.require(info["installed"] == expected, "Review changed installed provider location")
    directory = ROOT / expected
    INPUTS.require(not directory.is_symlink(), "Installed provider must remain local")
    for name, content in files.items():
        filename = directory / name.removeprefix("package/")
        INPUTS.require(stat.S_ISREG(filename.lstat().st_mode) and filename.read_bytes() == content, "Installed package bytes mismatch: " + name)
    lock_path = "vendor/watchers/upstream/package-lock.json" if reference else "package-lock.json"
    INPUTS.require(info["lock"] == lock_path, "Review changed consuming lock")
    provider = json.loads((ROOT / lock_path).read_text())["packages"]["node_modules/" + info["name"]]
    INPUTS.require(provider["version"] == info["version"] and provider["integrity"] == info["integrity"], "Consuming lock identity mismatch")


def main():
    record = json.loads((SOURCE / "UPSTREAM.json").read_text())
    INPUTS.require(record["schemaVersion"] == 1, "Review changed record schema")
    INPUTS.require([(info["name"], info["version"]) for info in record["packages"]] == [("chokidar", "6.0.0"), ("readdirp", "5.1.1"), ("chokidar", "5.0.0")], "Review changed provider identities")
    for info in record["packages"]:
        verify_package(info)
    verify_package({**record["jiti"], "installed": "vendor/watchers/upstream/node_modules/jiti", "lock": "vendor/watchers/upstream/package-lock.json"})
    manifest = json.loads((ROOT / "package.json").read_text())
    INPUTS.require(manifest["overrides"]["chokidar"] == "6.0.0", "Review changed watcher cohort")
    INPUTS.require(manifest["overrides"]["@nuxt/devtools"]["."] == "4.1.0" and manifest["overrides"]["@nuxt/devtools-kit"] == "4.1.0", "Review changed Nuxt DevTools cohort")
    print("Original watcher modules, types, licenses and consuming locks verified")


if __name__ == "__main__":
    main()
