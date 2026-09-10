#!/usr/bin/env python3
"""Lossless compression of this uninstalled Stage4 candidate; no shared prune."""
import gzip,hashlib,json,shutil,subprocess
from pathlib import Path
B=Path('/srv/alica-dsh-development');old=B/'stage4-package-qa2';new=B/'stage4-package-qa3'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 return h.hexdigest()
assert not Path('/opt/dsh2-stage4-qa2').exists() and not Path('/opt/dsh2-stage4-qa3').exists()
assert not subprocess.check_output(['sudo','-n','docker','ps','-aq','--filter','label=com.docker.compose.project=dsh2-stage4-qa2']).strip()
assert sha(old/'release.json')=='d0dbef4352c82846aa4919b1f9784a28a0867242180f753fc99ebf5f6b334d21'
r=json.loads((old/'release.json').read_text());assert not new.exists()
for n,h in r['files'].items():assert sha(old/n)==h
new.mkdir()
for n in r['files']:
 if n!='images.tar':shutil.copy2(old/n,new/n)
with (old/'images.tar').open('rb') as src,(new/'images.tar').open('wb') as dst:
 with gzip.GzipFile(filename='',mode='wb',fileobj=dst,compresslevel=1,mtime=0) as gz:shutil.copyfileobj(src,gz,8*1024*1024)
h=hashlib.sha256()
with gzip.open(new/'images.tar','rb') as src:
 for b in iter(lambda:src.read(8*1024*1024),b''):h.update(b)
assert h.hexdigest()==r['files']['images.tar'],'Compressed artifact is not lossless'
record={'uncompressedArchiveSha256':h.hexdigest(),'compressedArchiveSha256':sha(new/'images.tar'),'sourceReleaseSha256':sha(old/'release.json'),'losslessRoundTripVerified':True,'sharedImagesVolumesCachesPruned':False}
r['release']='dsh-stage4-candidate-qa3';r['archive_compression']='gzip; Docker load/tarfile auto-detection';r['uncompressed_images_sha256']=h.hexdigest();r['files']['images.tar']=record['compressedArchiveSha256']
(new/'release.json').write_text(json.dumps(r,indent=2)+'\n');(new/'release.sha256').write_text(sha(new/'release.json')+'  release.json\n')
record['newReleaseSha256']=sha(new/'release.json');(new/'compression-evidence.json').write_text(json.dumps(record,indent=2)+'\n')
# Only this uninstalled, unqualified candidate archive is retired. Its exact bytes
# remain recoverable from the verified gzip archive; metadata/evidence is retained.
(old/'artifact-retired.json').write_text(json.dumps(record,indent=2)+'\n');(old/'images.tar').unlink()
print(json.dumps(record|{'freeGiB':shutil.disk_usage(B).free/1024**3}))
