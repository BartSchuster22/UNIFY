#!/usr/bin/env python3
"""Retire only the failed, uninstalled Stage3 QA1 image archive; retain evidence/data."""
import hashlib,json,pathlib,subprocess
b=pathlib.Path('/srv/alica-dsh-development/stage3-package-qa1');expected='5d6715209e97231e0defd6af5db4cd1d75e76bf9f1db7ca6b3cb0da0f8fcd859'
assert hashlib.sha256((b/'release.json').read_bytes()).hexdigest()==expected
r=json.loads((b/'release.json').read_text());assert r['release']=='dsh-stage3-candidate-qa1'
assert not subprocess.check_output(['sudo','-n','docker','ps','-aq','--filter','label=com.docker.compose.project=dsh2-stage3-qa1'],text=True).strip()
p=b/'images.tar';assert p.is_file() and not p.is_symlink();h=hashlib.sha256()
with p.open('rb') as f:
 for block in iter(lambda:f.read(8*1024*1024),b''):h.update(block)
assert h.hexdigest()==r['files']['images.tar']
receipt={'artifactRetired':True,'reason':'QA1 failed full foundation migration; uninstalled through lifecycle before retirement','releaseSha256':expected,'removedArchiveSha256':h.hexdigest(),'bytes':p.stat().st_size,'manifestsAndEvidenceRetained':True,'databaseVolumeRetained':True,'stage2ArtifactsTouched':False}
p.unlink();(b/'artifact-retired.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
