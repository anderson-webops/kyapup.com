import importlib.util
import json
import subprocess
import sys
from pathlib import Path
import tempfile
import tarfile
import unittest

spec = importlib.util.spec_from_file_location("artifact", Path(__file__).with_name("runtime-artifact.py"))
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


class RuntimeArtifactTests(unittest.TestCase):
    def setUp(self):
        base = Path(__file__).resolve().parent.parent / ".ai-work/runs"
        base.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=base)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.contract = json.loads(artifact.CONTRACT.read_text())
        for name in self.contract["required"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic runtime module\n")
        (self.root / "package.json").write_text(json.dumps({"version": "1.0.0"}))
        (self.root / "back-end/package.json").write_text(json.dumps({"version": "1.0.0", "dependencies": {}}))
        (self.root / "front-end/package.json").write_text(json.dumps({"version": "1.0.0"}))
        (self.root / "package-lock.json").write_text(json.dumps({"version": "1.0.0", "packages": {"": {"version": "1.0.0"}}}))
        (self.root / "back-end/package-lock.json").write_text((self.root / "package-lock.json").read_text())
        marker = json.dumps({"release": "v1.0.0", "commitSha": "a"*40, "deployedAt": "2026-09-16T00:00:00Z"})
        (self.root / "front-end/.output/public/release.json").write_text(marker)
        (self.root / ".vitesse-release-prepared.json").write_text(marker)

    def manifest(self):
        return {"format": 1, "commit": "a" * 40, "contract": self.contract,
                "files": artifact.inventory(self.root)}

    def test_valid_tree(self):
        artifact.validate(self.root, self.manifest())

    def test_hash_tampering(self):
        manifest = self.manifest()
        (self.root / "back-end/dist/app.js").write_text("changed")
        with self.assertRaisesRegex(ValueError, "hashes"):
            artifact.validate(self.root, manifest)

    def test_missing_module_even_if_the_inventory_omits_it(self):
        (self.root / "back-end/dist/boundedRateStore.js").unlink()
        with self.assertRaisesRegex(ValueError, "required runtime path missing"):
            artifact.validate(self.root, self.manifest())

    def test_symlinks_and_private_state(self):
        for name in [".env", "credentials.json", "back-end/dist/key.pem", "back-end/dist/enrollment.sqlite3"]:
            with self.subTest(name=name):
                path = self.root / name
                path.write_text("synthetic forbidden content")
                with self.assertRaisesRegex(ValueError, "forbidden"):
                    self.manifest()
                path.unlink()
        (self.root / "back-end/dist/escape").symlink_to("/tmp")
        with self.assertRaisesRegex(ValueError, "forbidden"):
            self.manifest()

    def test_missing_production_dependency(self):
        package = {"version": "1.0.0", "dependencies": {"fixture": "1.0.0"}}
        (self.root / "back-end/package.json").write_text(json.dumps(package))
        (self.root / "back-end/package-lock.json").write_text(json.dumps({
            "version": "1.0.0", "packages": {"": package, "node_modules/fixture": {"version": "1.0.0"}}}))
        with self.assertRaisesRegex(ValueError, "production dependency missing"):
            artifact.validate(self.root, self.manifest())

    def test_static_identity_cannot_be_rehashed_to_another_commit(self):
        path = self.root / "front-end/.output/public/release.json"
        value = json.loads(path.read_text())
        value["commitSha"] = "b" * 40
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "static deployment identity"):
            artifact.validate(self.root, self.manifest())

    def test_malformed_identity_cannot_be_rehashed(self):
        for marker in [{}, {"release": "v1.0.0", "commitSha": "a" * 40},
                       {"release": "v1.0.0", "commitSha": "a" * 40, "deployedAt": "2026-02-30T00:00:00Z"}]:
            with self.subTest(marker=marker):
                for name in ["front-end/.output/public/release.json", ".vitesse-release-prepared.json"]:
                    (self.root / name).write_text(json.dumps(marker))
                with self.assertRaisesRegex(ValueError, "invalid deployment identity"):
                    artifact.validate(self.root, self.manifest())

    def test_unlisted_native_and_development_packages_are_rejected(self):
        native = self.root / "back-end/dist/unreviewed.node"
        native.write_text("synthetic native fixture")
        with self.assertRaisesRegex(ValueError, "undeclared native binding"):
            artifact.validate(self.root, self.manifest())
        native.unlink()
        package = self.root / "back-end/node_modules/fixture/package.json"
        package.parent.mkdir(parents=True)
        package.write_text(json.dumps({"version": "1.0.0"}))
        lock = self.root / "back-end/package-lock.json"
        value = json.loads(lock.read_text())
        value["packages"]["node_modules/fixture"] = {"version": "1.0.0", "dev": True}
        lock.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "development dependency in runtime"):
            artifact.validate(self.root, self.manifest())

    def test_exact_archive_roundtrip_and_post_copier_verification(self):
        with tempfile.TemporaryDirectory(dir=self.root.parent) as temporary:
            output = Path(temporary)
            archive = output / "runtime.tar.gz"
            unpacked = output / "unpacked"
            unpacked.mkdir()
            command = [sys.executable, "-B", str(Path(artifact.__file__))]
            # Handcrafted synthetic fixture exercises verification on any host;
            # the production pack command itself requires Linux ARM64.
            (self.root / artifact.MANIFEST).write_text(json.dumps(self.manifest()))
            with tarfile.open(archive, "w:gz") as target:
                for path in self.root.rglob("*"):
                    if path.is_file(): target.add(path, arcname=path.relative_to(self.root).as_posix())
            sha = artifact.digest(archive)
            arguments = ["--archive", str(archive), "--sha256", sha, "--commit", "a" * 40]
            subprocess.run([*command, "unpack", str(unpacked), *arguments], check=True, capture_output=True)
            subprocess.run([*command, "verify", str(unpacked), *arguments], check=True, capture_output=True)
            (unpacked / "back-end/dist/boundedRateStore.js").unlink()
            # Rehashing the copier's incomplete tree cannot override the trusted archive.
            manifest = json.loads((unpacked / artifact.MANIFEST).read_text())
            manifest["files"].pop("back-end/dist/boundedRateStore.js")
            (unpacked / artifact.MANIFEST).write_text(json.dumps(manifest))
            result = subprocess.run([*command, "verify", str(unpacked), *arguments], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("differs from trusted archive", result.stderr)


if __name__ == "__main__":
    unittest.main()
