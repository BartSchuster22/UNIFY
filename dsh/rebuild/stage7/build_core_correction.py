#!/usr/bin/env python3
"""Development-only, immutable Core module correction. No target mutation."""
import argparse,hashlib,json,os,shutil,subprocess,tarfile
from pathlib import Path
PIN='43a98d80cb49223e76be72b040913826552ba82cdd209e065d9e18162d4c68c6'
BASE='sha256:40156a00c8968ab082bd327bc16229f46834bd18305be2ab48f54076abadd5e2'
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def run(*a):return subprocess.check_output(a,text=True).strip()
def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--modules',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--revision',required=True);a=p.parse_args()
 assert len(a.revision)==40 and all(c in '0123456789abcdef' for c in a.revision)
 assert str(a.output).startswith('/srv/alica-dsh-development/') and not a.output.exists()
 assert sha(a.source)==PIN and shutil.disk_usage(a.output.parent).free>6*1024**3
 a.output.mkdir();bundle=a.output/'bundle';bundle.mkdir()
 hashes={}
 with tarfile.open(a.source) as t:
  for m in t:
   parts=m.name.split('/');assert m.isfile() and len(parts)==2 and parts[0]=='bundle' and parts[1] not in ('','.','..') and m.name not in hashes
   h=hashlib.sha256();src=t.extractfile(m);assert src is not None
   dst=None if parts[1]=='images.tar' else (bundle/parts[1]).open('xb')
   with src:
    for b in iter(lambda:src.read(1048576),b''):
     h.update(b)
     if dst:dst.write(b)
   if dst:dst.close();(bundle/parts[1]).chmod(0o755 if parts[1]=='alicactl' else 0o644)
   hashes[m.name]=h.hexdigest()
 meta=json.loads((bundle/'release.json').read_text());assert meta['images']['unify-core']['id']==BASE
 assert all(hashes['bundle/'+n]==v for n,v in meta['files'].items())
 for role,v in meta['images'].items():assert json.loads(run('sudo','-n','docker','image','inspect',v['id']))[0]['Id']==v['id']
 context=a.output/'context';context.mkdir();material={}
 for name in ('knowledge.js','service.js'):
  src=a.modules/name;assert src.is_file();shutil.copy2(src,context/name);material[name]=sha(src)
 base_tag='alica-stage7-core-base:40156a00';run('sudo','-n','docker','tag',BASE,base_tag)
 tag='alica-stage7-core:'+a.revision[:7]
 (context/'Dockerfile').write_text('FROM '+base_tag+'\nCOPY --chown=65532:65532 knowledge.js service.js /app/dist/applications/\nLABEL com.alica.stage7.core-correction="'+a.revision+'"\n')
 with (a.output/'build.log').open('w') as log:subprocess.run(['sudo','-n','docker','build','--network=none','--pull=false','-t',tag,str(context)],stdout=log,stderr=subprocess.STDOUT,check=True)
 image=json.loads(run('sudo','-n','docker','image','inspect',tag))[0];assert image['Architecture']=='amd64' and image['Os']=='linux'
 old=meta['images']['unify-core'];old_id=old['id'];old.update({'reference':tag,'id':image['Id'],'base_image_id':BASE,'size_bytes':image['Size'],'filesystem_diff_ids':image['RootFS']['Layers'],'source_correction':{'revision':a.revision,'modules':material}})
 with (bundle/'images.tar').open('xb') as f:subprocess.run(['sudo','-n','docker','save',*[v['id'] for v in meta['images'].values()]],stdout=f,check=True)
 # Exported OCI manifest identity must bind the newly built config digest.
 with tarfile.open(bundle/'images.tar') as t:
  matches=[]
  for m in t:
   if m.isfile() and m.name.startswith('blobs/sha256/') and m.size<200000:
    raw=t.extractfile(m).read()
    try:v=json.loads(raw)
    except (ValueError,UnicodeError):continue
    if isinstance(v,dict) and v.get('config',{}).get('digest')==image['Id']:
     assert hashlib.sha256(raw).hexdigest()==m.name.rsplit('/',1)[-1];matches.append(raw)
  assert len(matches)==1
 (bundle/'unify-core.oci-manifest.json').write_bytes(matches[0]);old['oci_reference']=tag.split(':')[0]+'@sha256:'+sha(bundle/'unify-core.oci-manifest.json')
 template=bundle/'compose.template.json';text=template.read_text();text=text.replace(old_id,image['Id']);template.write_text(text)
 meta['release']='stage7-qa4-'+a.revision[:7];meta['source_revisions']['core_correction']=a.revision
 meta['stage7_assembly'].update({'coreCorrectionSource':a.revision,'runtimeImagesUnchanged':False,'changedRuntimeRoles':['unify-core'],'correctionBaseArchiveSha256':PIN,'productionAccepted':False})
 meta['files']={n:sha(bundle/n) for n in meta['files']};(bundle/'release.json').write_text(json.dumps(meta,indent=2)+'\n');release=sha(bundle/'release.json');(bundle/'release.sha256').write_text(release+'  release.json\n')
 archive=a.output/('dsh-stage7-qa4-'+a.revision[:7]+'-linux-amd64.tar.gz')
 assert shutil.disk_usage(a.output).free>2*1024**3
 with tarfile.open(archive,'w:gz',compresslevel=1) as t:
  for f in sorted(bundle.iterdir()):
   info=t.gettarinfo(f,arcname='bundle/'+f.name);info.uid=info.gid=0;info.uname=info.gname='root';info.mode=0o755 if f.name=='alicactl' else 0o644
   with f.open('rb') as src:t.addfile(info,src)
 receipt={'schema':'stage7-core-correction-build/v1','sourceRevision':a.revision,'baseArchiveSha256':PIN,'archive':archive.name,'archiveSha256':sha(archive),'releaseSha256':release,'newCoreImage':image['Id'],'modules':material,'stage7Accepted':False}
 (a.output/'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
if __name__=='__main__':main()
