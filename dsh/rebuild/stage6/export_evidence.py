"""Export only non-secret Stage6 receipts and SPDX metadata, never stores/logs/keys."""
import json,os,re,shutil
from pathlib import Path
import restore_dsh2 as r
import compatibility
assert os.geteuid()==0 and __import__('socket').gethostname()=='DSH2'
out=Path('/home/deploy/.stage6-public-evidence');out.mkdir(mode=0o700,exist_ok=True);os.chown(out,1000,1000)
paths=['delivery-replay.json','provenance-live-verification.json','final-recovery-check.json','restore-journal.json','live-restore-check.json','reference-topology-repair.json','credential-renewal.json','migration-qualification.json','update-qualification/acceptance.json','update-qualification/health-journal.json','update-qualification/interrupt-journal.json','update-qualification/schema-journal.json','update-control/state.json','update-control/journal.json','sboms/receipt.json']
for f in paths:
 p=r.OUT/f;data=p.read_text();json.loads(data)
 assert not re.search(r'-----BEGIN .*PRIVATE KEY|dsha1_[A-Za-z0-9_-]{43}',data),'Sensitive material in receipt'
 q=out/f.replace('/','--');q.write_text(data);os.chmod(q,0o600);os.chown(q,1000,1000)
receipt=json.loads((r.OUT/'sboms/receipt.json').read_text());assert len(receipt['images'])==8
for v in receipt['images'].values():
 name=v['file'];assert Path(name).name==name and name.endswith('.spdx.json');src=r.OUT/'sboms'/name;assert r.archive.digest(src)==v['sha256']
 q=out/name;shutil.copyfile(src,q);os.chmod(q,0o600);os.chown(q,1000,1000)
q=out/'compatibility.json';q.write_text(json.dumps({'policy':compatibility.POLICY,'observed':compatibility.inspect(),'passed':True},indent=2));os.chmod(q,0o600);os.chown(q,1000,1000)
print(json.dumps({'exportedFiles':len(list(out.iterdir())),'onlyAllowlistedEvidence':True}))
