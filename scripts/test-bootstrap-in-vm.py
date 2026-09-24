"""Administrative installer regression. Run only in the explicitly staged disposable VM."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

assert os.geteuid() == 0 and sys.argv[1:] == ["--disposable-vm"]
marker = Path('/run/vitesse-source-validation-vm')
assert marker.is_file() and marker.read_text() == 'isolated-public-source-fixture\n'
assert marker.stat().st_uid == 0
assert not Path('/srv/kyapup').exists(), 'Use a fresh disposable VM, never an installed host'
source = Path(__file__).resolve().parent.parent
control = Path('/root/vitesse-admin-fixture')
control.mkdir(mode=0o700)
for name in ['deploy', 'scripts']:
    shutil.copytree(source / name, control / name)
shutil.copyfile(source / 'package.json', control / 'package.json')
installer = control / 'deploy/systemd/install-service.sh'
env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'NODE_BIN_DIR': '/opt/node-24.18.1/bin'}

def run():
    return subprocess.run(['bash', str(installer)], env=env, text=True, capture_output=True, timeout=20)

result = run()
assert result.returncode == 0, result.stdout + result.stderr
version = json.loads((control / 'package.json').read_text())['version']
helper = Path('/usr/local/libexec/kyapup-release') / version
assert (helper / 'deploy/systemd/promote-release.sh').is_file()
assert helper.stat().st_uid == 0 and not helper.stat().st_mode & 0o022
unit = Path('/etc/systemd/system/kyapup-api.service')
original_unit = unit.read_bytes()
assert subprocess.run(['systemctl', 'is-active', '--quiet', 'kyapup-api.service']).returncode != 0
base = Path('/srv/kyapup')
for path in [base / 'current', base / 'releases/unauthorized']:
    denied = subprocess.run(['runuser', '-u', 'kyapup', '--', 'touch', str(path)], capture_output=True)
    assert denied.returncode != 0, 'Build account changed administrative state'
assert run().returncode != 0, 'Existing helper version was overwritten'
assert unit.read_bytes() == original_unit

# Existing directory metadata is a host contract, not something this installer
# silently normalizes. A new helper must not be installed when review is needed.
package = json.loads((control / 'package.json').read_text())
package['version'] = '999.0.0'
(control / 'package.json').write_text(json.dumps(package))
base.chmod(0o700)
result = run()
assert result.returncode != 0 and 'left unchanged' in result.stderr
assert base.stat().st_mode & 0o777 == 0o700
assert not Path('/usr/local/libexec/kyapup-release/999.0.0').exists()
base.chmod(0o750)

# Model replacement after a privileged existence check. The old cache creation
# pattern follows this symlink; the updated installer must never visit that path.
sink = Path('/root/vitesse-cache-fixture')
sink.mkdir(mode=0o755)
cache = base / 'shared/npm-cache'
cache.symlink_to(sink)
old = subprocess.run(['/usr/bin/install', '-d', '-o', 'kyapup', '-g', 'kyapup', '-m', '0700', str(cache)], capture_output=True)
followed = sink.stat().st_uid != 0 or sink.stat().st_mode & 0o777 != 0o755
print(json.dumps({'historicalCachePath': 'followed' if followed else 'rejected', 'exit': old.returncode}), flush=True)
os.chown(sink, 0, 0)
sink.chmod(0o755)
package['version'] = '999.0.1'  # Synthetic helper revision, never a source release.
(control / 'package.json').write_text(json.dumps(package))
result = run()
assert result.returncode == 0, result.stdout + result.stderr
assert sink.stat().st_uid == 0 and sink.stat().st_mode & 0o777 == 0o755
assert unit.read_bytes() == original_unit
# A mutable adjacent service unit fails the trusted bootstrap guard before effects.
package['version'] = '999.0.2'
(control / 'package.json').write_text(json.dumps(package))
(control / 'deploy/systemd/kyapup-api.service').chmod(0o666)
assert run().returncode != 0
assert not Path('/usr/local/libexec/kyapup-release/999.0.2').exists()
assert unit.read_bytes() == original_unit
print(json.dumps({'administrativeBootstrap': 'passed', 'protectedPointerAndReleaseRoot': True,
                  'immutableHelpers': True, 'existingUnitPreserved': True,
                  'existingDirectoryMetadataPreserved': True,
                  'cacheSymlinkUntouched': True, 'mutableUnitRejected': True,
                  'serviceNeverStarted': True, 'installerSha256': hashlib.sha256(installer.read_bytes()).hexdigest()}), flush=True)
