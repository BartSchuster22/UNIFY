#!/usr/bin/env python3
"""Isolated candidate installation through the unmodified lifecycle driver."""
import hashlib,json,pathlib,subprocess
BASE=pathlib.Path('/srv/alica-dsh-development');BUNDLE=BASE/'stage3-package-qa3';OUT=BASE/'stage3-tests/installed-qa3';CELL='dsh2-stage3-qa3';ROOT='/opt/'+CELL
OUT.mkdir(mode=0o700,exist_ok=True)
def docker(*args):return subprocess.check_output(['sudo','-n','docker',*args],text=True)
def snapshot():
 ids=docker('ps','-aq').split();rows=json.loads(docker('inspect',*ids)) if ids else []
 return {r['Id']:{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'status':r['State']['Status']} for r in rows if r['Config'].get('Labels',{}).get('com.docker.compose.project')!=CELL}
assert not pathlib.Path(ROOT).exists(),'New isolated installation only'
assert not docker('ps','-aq','--filter','label=com.docker.compose.project='+CELL).strip()
before=snapshot();(OUT/'preservation-before.json').write_text(json.dumps(before,indent=2))
request={'cell':CELL,'origin':'https://stage3.dsh.invalid:19444','port':19444,'bind':'127.0.0.1','owner':'owner'}
(OUT/'request.json').write_text(json.dumps(request));h=hashlib.sha256((BUNDLE/'release.json').read_bytes()).hexdigest()
args=['sudo','-n','python3',str(BUNDLE/'install.py'),'install','--bundle',str(BUNDLE),'--release-sha256',h,'--root',ROOT,'--request',str(OUT/'request.json')]
with (OUT/'install.log').open('w') as log:r=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=1000)
assert snapshot()==before,'Existing workloads changed'
print(json.dumps({'installerExit':r.returncode,'existingWorkloadsUnchanged':True,'root':ROOT,'releaseSha256':h}))
print((OUT/'install.log').read_text()[-4000:]);raise SystemExit(r.returncode)
