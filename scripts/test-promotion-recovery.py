"""Run the actual trusted promoter under synthetic root with fake external services."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile

assert os.geteuid() == 0 and not Path('/srv').exists()
SOURCE = Path('/source')
STUB = r'''#!/usr/bin/python3
import json, os, pathlib, signal, sys
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
mode = os.environ['FIXTURE_MODE']
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
current = root / 'current'
candidate = current.is_symlink() and current.resolve().name == 'candidate'
def once(key):
    p=root/key
    if p.exists():return False
    p.touch();return True
if name == 'sleep':sys.exit(0)
if name == 'systemctl':
    if args[0] == 'is-active':sys.exit(0 if current.is_symlink() else 3)
    if args[0] == 'restart' and candidate and mode == 'interrupt' and once('interrupted'):
        os.kill(os.getppid(),signal.SIGTERM)
    if args[0] == 'restart' and candidate and mode == 'restart-failure' and once('restart-failed'):sys.exit(1)
    if args[0] == 'restart' and not candidate and mode == 'rollback-failure':sys.exit(1)
    sys.exit(0)
if name == 'nginx':
    if '-t' in args and candidate and mode == 'nginx-failure' and once('nginx-failed'):sys.exit(1)
    sys.exit(0)
if name == 'curl':
    if candidate and mode in ['bad-health','rollback-failure','first-failure']:sys.exit(22)
    if candidate and mode == 'ipv6-failure' and '--ipv6' in args:sys.exit(22)
    url=next(a for a in args if a.startswith(('http://','https://')))
    if mode in ['alternate-port','custom-probes'] and '127.0.0.1:3006' in url:sys.exit(22)
    if mode=='wrong-service-readiness' and candidate and ':4006/' in url and url.endswith('/readyz'):sys.exit(22)
    output=pathlib.Path(args[args.index('--output')+1])
    if '--write-out' in args:
        print('405' if '-X' in args else '404',end='');sys.exit(0)
    if url.endswith('/release.json') and candidate and mode=='empty-public-identity':
        output.write_text('{}')
    elif url.endswith('/release.json'):
        output.write_bytes((current/'front-end/.output/public/release.json').read_bytes())
    elif url.endswith(('/api/health','/readyz','/status','/dependencies-ready')):output.write_text('{"ok":true}')
    else:
        output.write_text('Synthetic chess page')
        pathlib.Path(args[args.index('--dump-header')+1]).write_text("Content-Security-Policy: frame-ancestors 'none'\nX-Content-Type-Options: nosniff\nX-Frame-Options: DENY\n")
    with (root/'probes').open('a') as f:f.write(' '.join(args)+'\n')
    sys.exit(0)
raise SystemExit('Unexpected fixture command')
'''


def setup(root):
    root.mkdir(parents=True, mode=0o755)
    control=root/'control'
    for folder in ['scripts','deploy']:
        shutil.copytree(SOURCE/folder,control/folder)
    spec=importlib.util.spec_from_file_location('artifact',control/'scripts/runtime-artifact.py')
    artifact=importlib.util.module_from_spec(spec);spec.loader.exec_module(artifact)
    (control/'package.json').write_text(json.dumps({'version':'2.1.2'}))
    candidate=root/'releases/candidate'
    candidate.mkdir(parents=True)
    contract=json.loads(artifact.CONTRACT.read_text())
    required=contract['required']+[p.replace('*','fixture') for p in contract.get('requiredPatterns',[])]
    for name in required:
        p=candidate/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('Synthetic runtime file\n')
    package={'version':'2.1.2'}
    backend={**package,'type':'module','dependencies':{'express':'5.2.1'}}
    express=candidate/'back-end/node_modules/express/package.json'
    express.parent.mkdir(parents=True)
    express.write_text(json.dumps({'version':'5.2.1'}))
    for name,value in [('package.json',package),('front-end/package.json',package),('back-end/package.json',backend),
                       ('package-lock.json',{'version':'2.1.2','packages':{'':backend,'node_modules/express':{'version':'5.2.1'}}}),
                       ('back-end/package-lock.json',{'version':'2.1.2','packages':{'':backend,'node_modules/express':{'version':'5.2.1'}}})]:
        (candidate/name).write_text(json.dumps(value))
    metadata={'release':'v2.1.2','commitSha':'a'*40,'deployedAt':'2026-09-17T00:00:00Z'}
    for name in ['.vitesse-release-prepared.json','front-end/.output/public/release.json']:
        (candidate/name).write_text(json.dumps(metadata))
    # This application module must never be interpreted by privileged promotion.
    (candidate/'back-end/dist/app.js').write_text("import { writeFileSync } from 'node:fs'; writeFileSync('/fixture/ROOT_CODE_EXECUTED','bad')")
    manifest={'format':1,'commit':'a'*40,'contract':contract,'files':artifact.inventory(candidate)}
    (candidate/artifact.MANIFEST).write_text(json.dumps(manifest))
    archive=root/'approved.tar.gz'
    with tarfile.open(archive,'w:gz') as out:
        for p in candidate.rglob('*'):
            if p.is_file():out.add(p,arcname=p.relative_to(candidate).as_posix(),recursive=False)
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    previous=root/'releases/previous'
    shutil.copytree(candidate,previous)
    metadata.update(release='v2.1.1',commitSha='b'*40)
    for name in ['.vitesse-release-prepared.json','front-end/.output/public/release.json']:
        (previous/name).write_text(json.dumps(metadata))
    (root/'current').symlink_to(previous)
    recovery=root/'.deployment-recovery';recovery.mkdir(mode=0o700)
    return control,candidate,previous,archive,digest,recovery


Path('/fixture/runtime').mkdir(parents=True)
shutil.copy2('/runtime/node', '/fixture/runtime/node')
Path('/usr/local/bin').mkdir(parents=True)
for name in ['curl','systemctl','nginx','sleep']:
    p=Path('/usr/local/bin')/name;p.write_text(STUB);p.chmod(0o755)
modes=['success','bad-health','ipv6-failure','interrupt','restart-failure','nginx-failure','rollback-failure',
       'lock-contention','invalid-current','tampered-artifact','mutable-helper','mutable-parent','mutable-candidate',
       'symlink-module','wrong-digest','first-success','first-failure','mutable-archive','mutable-contract',
       'mutable-previous','previous-is-parent','invalid-previous-identity','empty-public-identity',
       'ambiguous-runtime-promoter','ambiguous-runtime-installer','alternate-port','wrong-service-readiness',
       'mismatched-readiness-origin','custom-probes']
if len(sys.argv) > 1 and sys.argv[1] != 'all':
    assert sys.argv[1] in modes, 'Unknown isolated regression case'
    modes = [sys.argv[1]]
for mode in modes:
    root=Path('/fixture')/mode
    control,candidate,previous,archive,digest,recovery=setup(root)
    if mode.startswith('first-'):(root/'current').unlink()
    if mode=='invalid-current':(root/'current').unlink();(root/'current').mkdir()
    if mode=='tampered-artifact':(candidate/'back-end/dist/server.js').write_text('tampered')
    if mode=='mutable-helper':(control/'deploy/systemd/promote-release.sh').chmod(0o777)
    if mode=='mutable-parent':root.chmod(0o777)
    if mode=='mutable-candidate':(candidate/'back-end/dist/server.js').chmod(0o666)
    if mode=='symlink-module':
        p=candidate/'back-end/dist/server.js';p.unlink();p.symlink_to('/etc/passwd')
    if mode=='wrong-digest':digest='0'*64
    if mode=='mutable-archive':archive.chmod(0o666)
    if mode=='mutable-contract':(control/'deploy/runtime-artifact.json').chmod(0o666)
    if mode=='mutable-previous':(previous/'back-end/dist/app.js').chmod(0o666)
    if mode=='previous-is-parent':
        (root/'current').unlink();(root/'current').symlink_to(root/'releases')
        shutil.copyfile(previous/'.vitesse-release-prepared.json',root/'releases/.vitesse-release-prepared.json')
        previous=root/'releases'
    if mode=='invalid-previous-identity':(previous/'.vitesse-release-prepared.json').write_text('{}')
    held=None
    if mode=='lock-contention':
        held=(recovery/'promotion.lock').open('w');fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
    env={**os.environ,'NODE_BIN_DIR':'/fixture/runtime','PUBLIC_HOST':'vitesse-nuxt-template',
         'RELEASE_ROOT':str(root/'releases'),'CURRENT_LINK':str(root/'current'),
         'FIXTURE_ROOT':str(root),'FIXTURE_MODE':mode}
    command=['bash',str(control/'deploy/systemd/promote-release.sh'),str(candidate),str(archive),digest,'a'*40]
    sentinel=root/'UNTRUSTED_RUNTIME_EXECUTED'
    if mode.startswith('ambiguous-runtime-'):
        (root/'protected/bin').mkdir(parents=True)
        shutil.copy2('/runtime/node',root/'protected/bin/node')
        (root/'build/subdir').mkdir(parents=True)
        (root/'build/bin').mkdir()
        (root/'protected/link').symlink_to(root/'build/subdir')
        unsafe=root/'build/bin/node'
        unsafe.write_text('#!/bin/sh\ntouch "'+str(sentinel)+'"\nprintf "v24.18.1\\n"\n')
        unsafe.chmod(0o755)
        (root/'build').chmod(0o777)
        env['NODE_BIN_DIR']=str(root/'protected/link')+'/../bin'
        if mode.endswith('-installer'):command=['bash',str(control/'deploy/systemd/install-service.sh')]
    if mode in ['alternate-port','wrong-service-readiness','mismatched-readiness-origin','custom-probes']:
        env['HEALTH_URL']='http://127.0.0.1:4006/api/health'
    if mode=='mismatched-readiness-origin':env['READINESS_URL']='http://127.0.0.1:3006/readyz'
    if mode=='custom-probes':
        env['HEALTH_URL']='http://127.0.0.1:4006/status'
        env['READINESS_URL']='http://127.0.0.1:4006/dependencies-ready'
    try:
        result=subprocess.run(command,
                              env=env,capture_output=True,text=True,timeout=15)
    finally:
        if held:held.close()
    evidence=result.stdout+result.stderr
    success=mode in ['success','first-success','alternate-port','custom-probes']
    assert not sentinel.exists(),(mode,'untrusted runtime executed as root')
    assert (result.returncode==0)==success,(mode,evidence)
    assert not Path('/fixture/ROOT_CODE_EXECUTED').exists(),(mode,'candidate code executed as root')
    if mode=='first-failure':assert not (root/'current').exists(),evidence
    elif mode!='invalid-current':assert (root/'current').resolve()==(candidate if success else previous),(mode,evidence)
    records=list(recovery.glob('promotion-????????'))
    if mode=='rollback-failure':
        assert len(records)==1 and 'protected record retained' in evidence,evidence
        assert stat.S_IMODE(records[0].stat().st_mode)==0o600
    else:assert not records,(mode,evidence)
    if mode=='interrupt':assert result.returncode==143 and (root/'interrupted').exists(),evidence
    if success:
        probes=(root/'probes').read_text();assert '--ipv4' in probes and '--ipv6' in probes
        assert ('/dependencies-ready' if mode=='custom-probes' else '/readyz') in probes
        if mode in ['alternate-port','custom-probes']:assert '127.0.0.1:3006' not in probes
    print(json.dumps({'promotionRecovery':mode,'result':'passed'}),flush=True)
