import argparse
import gzip
import hashlib
import io
import json
import stat
import subprocess
import tarfile
import tempfile
import zlib
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor/unimport"
COMMIT = "bbd07768ddb4919205bcb5a3cbc06c3a2791981a"
TREE = "d3dec0a75a2be87cfd16ec7cee3d1716b75e4ad2"
TAG = "636f6dd4afa0c74469195f21d29c144ed1697efd"
FINGERPRINT = "83DFB8EACB2CCD9ACE75B47CFB8599EBAB9E40B9"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def regular_bytes(filename):
    require(stat.S_ISREG(filename.lstat().st_mode), "Source input must be a regular file")
    return filename.read_bytes()


def git_object_id(kind, data):
    return hashlib.sha1(kind.encode() + b" " + str(len(data)).encode() + b"\0" + data).hexdigest()


def git_object_payload(data, kind):
    require(len(data) <= 16384, "Signed Git object exceeds its bound")
    decoder = zlib.decompressobj()
    raw = decoder.decompress(data, 65537)
    require(len(raw) <= 65536 and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail, "Invalid compressed Git object")
    header, payload = raw.split(b"\0", 1)
    require(header == kind.encode() + b" " + str(len(payload)).encode(), "Git object header mismatch")
    return payload


def source_files(data):
    require(len(data) <= 8 * 1024 * 1024, "Source archive is too large")
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as compressed:
        payload = compressed.read(8 * 1024 * 1024 + 1)
    require(len(payload) <= 8 * 1024 * 1024, "Expanded source archive is too large")
    files = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            require(str(name) == member.name and not name.is_absolute() and ".." not in name.parts, "Unsafe source member path")
            require(name.parts[0] == "source" and len(name.parts) > 1, "Unexpected source member root")
            require(member.isfile() and member.mode == 0o644, "Source members must be regular nonexecutable files")
            filename = "/".join(name.parts[1:])
            require(filename not in files and len(files) < 512, "Duplicate or excessive source members")
            require(0 <= member.size <= 2 * 1024 * 1024, "Source member is too large")
            total += member.size
            require(total <= 8 * 1024 * 1024, "Unpacked source is too large")
            files[filename] = archive.extractfile(member).read()
    return files


def git_tree_id(files):
    tree = {}
    for filename, data in files.items():
        parts = filename.split("/")
        parent = tree
        for component in parts[:-1]:
            parent = parent.setdefault(component, {})
            require(isinstance(parent, dict), "Conflicting source paths")
        require(parts[-1] not in parent, "Conflicting source paths")
        parent[parts[-1]] = data

    def digest(directory):
        payload = bytearray()
        ordered = sorted(directory.items(), key=lambda item: (item[0] + ("/" if isinstance(item[1], dict) else "")).encode())
        for name, value in ordered:
            is_directory = isinstance(value, dict)
            identity = digest(value) if is_directory else git_object_id("blob", value)
            payload.extend(("40000 " if is_directory else "100644 ").encode() + name.encode() + b"\0" + bytes.fromhex(identity))
        return git_object_id("tree", payload)

    return digest(tree)


def signed_payload(data, kind):
    if kind == "tag":
        marker = b"-----BEGIN PGP SIGNATURE-----"
        require(data.count(marker) == 1, "Expected one signed tag")
        start = data.index(marker)
        return data[:start], data[start:]
    output = []
    signature = []
    skipping = False
    for line in data.splitlines(keepends=True):
        if line.startswith(b"gpgsig "):
            require(not signature, "Expected one signed commit")
            signature.append(line[7:])
            skipping = True
        elif skipping and line.startswith(b" "):
            signature.append(line[1:])
        else:
            skipping = False
            output.append(line)
    require(bool(signature), "Commit signature is required")
    return b"".join(output), b"".join(signature)


def verify_signature(data, kind, keyring):
    payload, signature = signed_payload(data, kind)
    parent = ROOT / ".ai-work/runs"
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="unimport-signature-", dir=parent) as temporary:
        directory = Path(temporary)
        directory.chmod(0o700)
        (directory / "payload").write_bytes(payload)
        (directory / "signature.asc").write_bytes(signature)
        result = subprocess.run(
            ["gpgv", "--homedir", str(directory), "--keyring", str(keyring), "--status-fd", "1", str(directory / "signature.asc"), str(directory / "payload")],
            capture_output=True, timeout=15, check=False,
        )
    valid = [line.split()[2] for line in result.stdout.decode().splitlines() if line.startswith("[GNUPG:] VALIDSIG ")]
    require(result.returncode == 0 and valid == [FINGERPRINT], "Signed upstream source verification failed")


def verify_source(record=None, archive=None):
    record = record if record is not None else json.loads((SOURCE / "UPSTREAM.json").read_text())
    require(record["schemaVersion"] == 1 and record["repository"] == "https://github.com/unjs/unimport", "Review changed upstream source")
    require(record["tag"] == "v7.0.2" and record["tagObject"] == TAG and record["commit"] == COMMIT and record["tree"] == TREE, "Review changed signed source identity")
    require(record["signerFingerprint"] == FINGERPRINT, "Review changed upstream signer")
    for name in ["tag.git", "commit.git", "signer.gpg"]:
        require(hashlib.sha256(regular_bytes(SOURCE / name)).hexdigest() == record["inputsSha256"][name], "Signed source input digest mismatch")
    data = archive if archive is not None else regular_bytes(SOURCE / "source.tgz")
    require(hashlib.sha256(data).hexdigest() == record["inputsSha256"]["source.tgz"], "Source archive digest mismatch")
    files = source_files(data)
    require(len(files) == 224 and git_tree_id(files) == TREE, "Archive does not reproduce the signed Git tree")
    commit = git_object_payload(regular_bytes(SOURCE / "commit.git"), "commit")
    tag = git_object_payload(regular_bytes(SOURCE / "tag.git"), "tag")
    require(git_object_id("commit", commit) == COMMIT and commit.startswith(f"tree {TREE}\n".encode()), "Signed commit object mismatch")
    require(git_object_id("tag", tag) == TAG and tag.startswith(f"object {COMMIT}\ntype commit\ntag v7.0.2\n".encode()), "Signed tag object mismatch")
    verify_signature(tag, "tag", SOURCE / "signer.gpg")
    verify_signature(commit, "commit", SOURCE / "signer.gpg")
    manifest = json.loads(files["package.json"])
    require(manifest["name"] == "unimport" and manifest["version"] == "7.0.2" and manifest["license"] == "MIT", "Signed source package identity mismatch")
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--extract", type=Path)
    args = parser.parse_args()
    files = verify_source()
    if args.extract:
        require(not args.extract.exists() and not args.extract.is_symlink(), "Extraction requires a new destination")
        args.extract.mkdir(parents=True)
        for filename, content in files.items():
            target = args.extract / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(0o644)
    print("Unimport signed tag, commit and complete 224-file source tree verified")


if __name__ == "__main__":
    main()
