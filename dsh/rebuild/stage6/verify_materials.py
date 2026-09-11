"""Verify the separately signed, non-installable materials statement on live DSH2."""
import json,os,socket
from pathlib import Path
import release_trust as t
import restore_dsh2 as r
import compatibility
assert os.geteuid()==0 and socket.gethostname()=='DSH2'
b=Path('/home/deploy/.stage6-inputs/materials-attestation');env=Path('/home/deploy/.stage6-inputs/materials-envelope.json')
verified=t.verify(t.load(env),t.load('/etc/alica-release-trust/stage6-qa.json'),b,r.RELEASE,0,'qa')
assert t.load(b/'release.json')['installable'] is False and t.digest(b/'base-release.json')==r.RELEASE
statement=t.load(b/'statement.json');assert statement['predicateType']=='https://aquiero.com/alica/observed-materials/v1'
for s in statement['subject']:
 image='sha256:'+s['digest']['sha256'];assert r.run(['docker','image','inspect',image,'--format','{{.Id}} {{.Architecture}} {{.Os}}'])==image+' amd64 linux'
 v=statement['predicate']['sboms'][s['name']];assert v['imageId']==image and t.digest(b/v['file'])==v['sha256']
assert len(statement['subject'])==8
result={'schema':'stage6-live-materials-verification/v1','signatureAndAllArtifactBytesVerified':True,'exactLiveImagesVerified':8,'compatibilityObserved':compatibility.inspect(),'passed':True,'wholeStage6Accepted':False};r.save(r.OUT/'provenance-live-verification.json',result);print(json.dumps(result))
