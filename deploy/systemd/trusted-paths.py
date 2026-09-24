#!/usr/bin/env python3
"""Reject mutable administrative inputs. Run only from a trusted installation."""
import argparse
import os
from pathlib import Path
import stat


def protected(path, tree=False):
    raw = os.fspath(path)
    # Do not collapse symlink/.. pairs into a different object than the caller uses.
    if not os.path.isabs(raw) or any(part in (".", "..") for part in raw.split(os.sep)):
        raise ValueError(f"Administrative input must be absolute without dot components: {raw}")
    path = Path(raw)
    for item in [path, *path.parents]:
        mode = item.lstat()
        if stat.S_ISLNK(mode.st_mode) or mode.st_uid != 0 or mode.st_mode & 0o022:
            raise ValueError(f"Administrative input is not protected: {item}")
        if not (stat.S_ISDIR(mode.st_mode) or stat.S_ISREG(mode.st_mode)):
            raise ValueError(f"Administrative input has an unsafe type: {item}")
    if tree:
        for item in path.rglob('*'):
            mode = item.lstat()
            if (stat.S_ISLNK(mode.st_mode) or mode.st_uid != 0 or mode.st_mode & 0o022
                    or not (stat.S_ISDIR(mode.st_mode) or stat.S_ISREG(mode.st_mode))):
                raise ValueError(f"Release tree is not protected: {item}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tree', action='append', default=[])
    parser.add_argument('paths', nargs='*')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Administrative path validation requires root.')
    for path in args.paths:
        protected(path)
    for path in args.tree:
        protected(path, tree=True)
