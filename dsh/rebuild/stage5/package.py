#!/usr/bin/env python3
"""Build only two COPY overlays and a self-contained, pinned Stage 5 candidate."""
import argparse,gzip,hashlib,json,os,shutil,subprocess,tarfile
from pathlib import Path

def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  while b:=f.read(8*1024*1024):h.update(b)
 return h.hexdigest()
def docker(*a):return subprocess.check_output(['sudo','-n','docker',*a],text=True)

# A listening server is insufficient: pg_isready succeeds even when unify is
# absent after interrupted initdb. Use the same TCP identity/database as migrations.
POSTGRES_READINESS = (
 'IFS= read -r PGPASSWORD < /run/secrets/postgres-password && '
 'export PGPASSWORD PGCONNECT_TIMEOUT=2 && '
 "psql -X -w -h postgresql -p 5432 -U unify_bootstrap -d unify "
 "-v ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null 2>&1"
)
def configure_postgres_readiness(compose):
 # Preserve the existing interval, timeout, retries, auth, and network policy.
 compose['services']['postgresql']['healthcheck']['test']=['CMD-SHELL',POSTGRES_READINESS]

def main():
 p=argparse.ArgumentParser();p.add_argument('--stage4',type=Path,required=True);p.add_argument('--stage4-sha256',required=True);p.add_argument('--inputs',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--revision',required=True);a=p.parse_args()
 os.nice(10)
 assert sha(a.stage4/'release.json')==a.stage4_sha256
 r=json.loads((a.stage4/'release.json').read_text())
 for n,h in r['files'].items():assert sha(a.stage4/n)==h,'Modified qualified Stage4 file'
 assert not a.output.exists();assert shutil.disk_usage(a.output.parent).free>6*1024**3
 a.output.mkdir();changed={}
 for service,folder,target in [('unify-core','gateway','/app/apps/gateway/dist'),('uniui','uniui','/app/apps/uniui/dist')]:
  base=r['images'][service]['id'];base_tag='alica-stage5-base-'+service+':'+a.revision
  docker('tag',base,base_tag)
  context=a.inputs/folder
  (context/'Dockerfile').write_text('FROM '+base_tag+'\nCOPY dist/ '+target+'/\nLABEL com.alica.operations-contract="alica-operations/v1"\n')
  ref='alica-stage5-'+service+':'+a.revision
  docker('build','--network=none','-t',ref,str(context))
  m=json.loads(docker('image','inspect',ref))[0]
  changed[service]={'reference':ref,'id':m['Id'],'base_image_id':base,'size_bytes':m['Size'],'architecture':m['Architecture'],'os':m['Os'],'filesystem_diff_ids':m['RootFS']['Layers']}
 for n in r['files']:
  if n!='images.tar':shutil.copyfile(a.stage4/n,a.output/n)
 shutil.copyfile(a.inputs/'ops.py',a.output/'ops.py');shutil.copyfile(a.inputs/'doghouse-dsh.tar',a.output/'doghouse-dsh.tar')
 compose=json.loads((a.output/'compose.template.json').read_text())
 configure_postgres_readiness(compose)
 for name,s in compose['services'].items():
  if name in r['images']:s['restart']='no' if name in ('hermes','memory-v4','unify-core') else 'on-failure:3'
 compose['services']['unify-core']['environment'].update(ALICA_OPERATIONS_FILE='/run/alica-operations/status.json',ALICA_CELL_ID='${ALICA_CELL_ID}')
 compose['services']['unify-core']['volumes'].append({'type':'bind','source':'./operations/public','target':'/run/alica-operations','read_only':True})
 (a.output/'compose.template.json').write_text(json.dumps(compose,indent=2)+'\n')
 r['images'].update(changed)
 with (a.output/'images.tar').open('wb') as f:
  proc=subprocess.Popen(['sudo','-n','docker','save',*[x['reference'] for x in r['images'].values()]],stdout=subprocess.PIPE)
  assert proc.stdout is not None
  with gzip.GzipFile(fileobj=f,mode='wb',compresslevel=1,mtime=0) as z:shutil.copyfileobj(proc.stdout,z,8*1024*1024)
  assert proc.wait()==0
 extra=['ops.py','doghouse-dsh.tar'];cache={}
 with tarfile.open(a.output/'images.tar') as archive:
  manifest_file=archive.extractfile('manifest.json');assert manifest_file is not None
  manifests=json.load(manifest_file)
  def descriptor(name,media):
   if name not in cache:
    h=hashlib.sha256();f=archive.extractfile(name);assert f is not None
    while b:=f.read(8*1024*1024):h.update(b)
    cache[name]=(h.hexdigest(),archive.getmember(name).size)
   h,size=cache[name];return {'mediaType':media,'digest':'sha256:'+h,'size':size}
  for service,item in changed.items():
   entry=next(m for m in manifests if item['reference'] in (m.get('RepoTags') or []))
   config=descriptor(entry['Config'],'application/vnd.oci.image.config.v1+json');assert config['digest']==item['id']
   layers=[descriptor(n,'application/vnd.oci.image.layer.v1.tar') for n in entry['Layers']]
   assert [x['digest'] for x in layers]==item['filesystem_diff_ids']
   name=service+'.oci-manifest.json';doc={'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json','config':config,'layers':layers}
   (a.output/name).write_text(json.dumps(doc,separators=(',',':')))
   extra.append(name);item['oci_reference']=item['reference'].rsplit(':',1)[0]+'@sha256:'+sha(a.output/name);item['oci_distribution']='offline verified manifest; blobs in images.tar'
 r['release']='dsh-stage5-candidate-'+a.revision;r['operations_contract']='alica-operations/v1'
 r['acceptance']='DEVELOPMENT CANDIDATE; no live Stage5 acceptance claimed'
 r['base_stage4_release_sha256']=a.stage4_sha256;r['source_revisions']['operations_bridge']=a.revision
 r['files']={n:sha(a.output/n) for n in set(r['files'])|set(extra)}
 (a.output/'release.json').write_text(json.dumps(r,indent=2)+'\n');(a.output/'release.sha256').write_text(sha(a.output/'release.json')+'  release.json\n')
 print(json.dumps({'candidate':str(a.output),'release_sha256':sha(a.output/'release.json'),'archive_bytes':(a.output/'images.tar').stat().st_size,'images':{s:i['id'] for s,i in changed.items()}}))
if __name__=='__main__':main()
