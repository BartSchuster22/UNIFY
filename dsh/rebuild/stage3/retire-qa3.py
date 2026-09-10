#!/usr/bin/env python3
"""Retire only failed QA3 after checking its restricted work is settled. Keep all data/evidence."""
import hashlib,json,pathlib,subprocess
BASE=pathlib.Path('/srv/alica-dsh-development');OUT=BASE/'stage3-tests/installed-qa3';B=BASE/'stage3-package-qa3';ROOT=pathlib.Path('/opt/dsh2-stage3-qa3')
EXPECTED='eb92d31a3dd130c13c25f670e3062be594319df9db7391fce23a8735e89f8528'
assert hashlib.sha256((B/'release.json').read_bytes()).hexdigest()==EXPECTED
name='dsh2-stage3-qa3-hermes-1'
meta=json.loads(subprocess.check_output(['docker','inspect',name]))[0];assert meta['Config']['Labels']['com.docker.compose.project']=='dsh2-stage3-qa3'
code="from hermes_cli import kanban_db;k=kanban_db.connect();assert k.execute(\"SELECT count(*) FROM tasks WHERE created_by=? AND status NOT IN ('done','archived')\",('alica-application/v1',)).fetchone()[0]==0;k.close()"
subprocess.run(['docker','exec','--user','10000:10001',name,'/opt/hermes/.venv/bin/python','-c',code],check=True)
ref=json.loads(subprocess.check_output(['docker','inspect','dsh3-reference-qa3']))[0];assert ref['Id']==(OUT/'reference-container-id').read_text() and ref['Config']['Labels']['com.alica.stage3.reference']=='qa3'
subprocess.run(['docker','stop','--time','25',ref['Id']],check=True,capture_output=True);subprocess.run(['docker','rm',ref['Id']],check=True,capture_output=True)
subprocess.run(['python3',str(B/'install.py'),'uninstall','--bundle',str(B),'--release-sha256',EXPECTED,'--root',str(ROOT),'--request',str(OUT/'request.json')],check=True)
assert json.loads((ROOT/'transaction.json').read_text())['state']=='uninstalled-data-retained'
archive=B/'images.tar';release=json.loads((B/'release.json').read_text());h=hashlib.sha256()
with archive.open('rb') as f:
 while x:=f.read(8*1024*1024):h.update(x)
assert h.hexdigest()==release['files']['images.tar']
report={'artifactRetired':True,'reason':'Empty-binding privacy blocker; replacing with QA4 after owner regression tests','removedArchiveSha256':h.hexdigest(),'dataAndEvidenceRetained':True,'restrictedNativeWorkSettled':True,'stage2ArtifactsTouched':False}
archive.unlink();(B/'artifact-retired.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
