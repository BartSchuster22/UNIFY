#!/usr/bin/env python3
"""Sync a qualified engineering package to the explicitly selected ALICA-v1 target.
Imports images only; exercise.py performs a second admission and all runtime operations.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
from render import render

def sync(package):
    key='/home/herman/.ssh/alica_v1_deploy_ed25519'
    target='deploy@167.233.135.142'
    ssh=['ssh','-i',key,'-o','BatchMode=yes',target]
    for name in ['render.py','exercise.py','admission.py','reset_failed.py']:
        shutil.copyfile(Path(__file__).with_name(name),package/name)
    from render import ROOT
    shutil.copyfile(ROOT/'deploy/hermes-runtime/acceptance-client.mjs',package/'acceptance-client.mjs')
    (package/'compose.template.json').write_text(json.dumps(render(),indent=2))
    names=['images.lock.json','compose.template.json','render.py','exercise.py','admission.py','reset_failed.py','acceptance-client.mjs']
    def upload():subprocess.run(['scp','-q','-i',key,*[str(package/f) for f in names],target+':/home/deploy/dsh-stage1-package/'],check=True)
    upload()
    gate=json.loads(subprocess.check_output(ssh+['sudo -n python3 /home/deploy/dsh-stage1-package/admission.py /home/deploy/dsh-stage1-package']))
    assert gate['admission']['pass'],gate
    print('Pre-import admission passed',flush=True)
    lock=json.loads((package/'images.lock.json').read_text())
    archive=package/lock['archive']['filename']
    import hashlib
    h=hashlib.sha256()
    with archive.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    assert h.hexdigest()==lock['archive']['sha256']
    with archive.open('rb') as f:subprocess.run(ssh+['sudo -n docker image load'],stdin=f,check=True)
    ids=[i['id'] for i in lock['images'].values()]
    import re
    assert all(re.fullmatch('sha256:[a-f0-9]{64}',x) for x in ids)
    data=subprocess.check_output(ssh+['sudo -n docker image inspect '+' '.join(ids)+" --format '{{json .}}'"],text=True)
    observed={i['Id']:i for i in map(json.loads,data.splitlines())}
    for i in lock['images'].values():
        assert observed[i['id']]['RootFS']['Layers']==i['filesystem_diff_ids']
        i['size_bytes']=observed[i['id']]['Size'];i['target_config_identity_verified']=True
    (package/'images.lock.json').write_text(json.dumps(lock,indent=2))
    upload()
    print('All 7 target config digests and filesystem diffID chains verified.',flush=True)

if __name__=='__main__':sync(Path(sys.argv[1]))
