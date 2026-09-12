"""Read-only image scans and delivered host-code inventory on quiesced DSH2.
Writes only a new audit directory. Never creates/starts/deletes containers.
"""
import ast,hashlib,json,os,socket,subprocess,tarfile,time
from pathlib import Path
B=Path('/srv/alica-stage7-72297c3/bundle')
O=Path('/var/lib/alica-stage74-licensing/run1')
SCANNER=Path('/home/deploy/stage74-syft')
PIN='abca2def61de9952fa06d3977bb1e064818facb9badfce502b450d3d6846a91f'
RELEASE='1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c'
def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def command(args):return subprocess.check_output(args,text=True,timeout=60)
def snapshot():
 ids=command(['docker','ps','-aq']).split()
 rows=json.loads(command(['docker','inspect',*ids])) if ids else []
 return {'containers':sorted([{'id':r['Id'],'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'paused':r['State']['Paused'],'started':r['State']['StartedAt'],'finished':r['State']['FinishedAt'],'restarts':r['RestartCount'],'mounts':sorted(r['Mounts'],key=lambda v:v['Destination'])} for r in rows],key=lambda r:r['id']),'images':sorted(set(command(['docker','image','ls','-aq','--no-trunc']).split()))}
def main():
 require(os.geteuid()==0 and socket.gethostname()=='DSH2','Wrong audit host/user')
 require(sha(SCANNER)==PIN and sha(B/'release.json')==RELEASE,'Scanner/release pin mismatch')
 O.mkdir(mode=0o700,parents=True,exist_ok=False);os.umask(0o077)
 before=snapshot();require(not any(r['running'] for r in before['containers']),'QA must remain quiesced')
 (O/'before.private.json').write_text(json.dumps(before,indent=2))
 r=json.loads((B/'release.json').read_text())
 for name,digest in r['files'].items():
  require(Path(name).name==name and not (B/name).is_symlink(),'Unsafe bundle member')
  require(sha(B/name)==digest,'Changed bundle member: '+name)
 images={k:v['id'] for k,v in r['images'].items()}
 with tarfile.open(B/'reference-image.tar') as t:
  m=json.load(t.extractfile('manifest.json'));require(len(m)==1,'Ambiguous reference archive')
  image='sha256:'+hashlib.sha256(t.extractfile(m[0]['Config']).read()).hexdigest()
  require(image=='sha256:453f59474c73eda86bdb3dcdcaebb0928bf593c86700da9a9ad2449ed52dec61','Unexpected reference image')
  images['reference-application']=image
 env={**os.environ,'SYFT_CHECK_FOR_APP_UPDATE':'false','SYFT_LICENSE_CONTENT':'all','SYFT_JAVA_USE_NETWORK':'false','SYFT_JAVA_USE_MAVEN_LOCAL_REPOSITORY':'false','SYFT_GOLANG_SEARCH_REMOTE_LICENSES':'false','SYFT_GOLANG_SEARCH_LOCAL_MOD_CACHE_LICENSES':'false','SYFT_GOLANG_SEARCH_LOCAL_VENDOR_LICENSES':'false','SYFT_JAVASCRIPT_SEARCH_REMOTE_LICENSES':'false','SYFT_PYTHON_SEARCH_REMOTE_LICENSES':'false','TMPDIR':str(O/'tmp')}
 (O/'tmp').mkdir();(O/'scanner-config.txt').write_text(subprocess.check_output([str(SCANNER),'config','--load'],env=env,text=True))
 report={'schema':'stage74-current-image-observations/v1','releaseSha256':RELEASE,'scannerSha256':PIN,'scanner':json.loads(command([str(SCANNER),'version','-o','json'])),'scope':'all-layers','licenceContent':'all','networkEnrichment':False,'referenceArchiveSha256':sha(B/'reference-image.tar'),'images':{},'stage74Accepted':False,'legalReviewComplete':False}
 def save():(O/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
 save()
 for name in sorted(images,key=lambda n:(n not in ['unify-core','reference-application'],n)):
  image=images[name];actual=command(['docker','image','inspect',image,'--format','{{.Id}}']).strip();require(actual==image,'Image identity mismatch')
  start=time.monotonic();spdx=O/(name+'.spdx.json');raw=O/(name+'.syft.private.json')
  args=['nice','-n','10',str(SCANNER),'scan','docker:'+image,'--scope','all-layers','--parallelism','2','-o','spdx-json='+str(spdx),'-o','syft-json='+str(raw)]
  with (O/(name+'.private.log')).open('w') as log:p=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=900)
  require(p.returncode==0,'Scanner failed: '+name)
  d=json.loads(spdx.read_text());require(d['spdxVersion']=='SPDX-2.3' and d.get('packages'),'Invalid/empty SPDX output')
  report['images'][name]={'imageId':image,'spdx':spdx.name,'spdxSha256':sha(spdx),'syftPrivateSha256':sha(raw),'packageOccurrences':len(d['packages']),'seconds':round(time.monotonic()-start,3)};save();print(json.dumps({'image':name,**report['images'][name]}),flush=True)
 # Exact delivered host code, not installed secrets/configuration/owner data.
 host=O/'host-code';host.mkdir();files=[]
 def add(name,data):
  p=host/name;require(not p.exists(),'Duplicate host file');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  entry={'path':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'licenceDisposition':'unreviewed-first-party-delivered-code'}
  if name.endswith('.py'):
   tree=ast.parse(data);entry['importRoots']=sorted({n.names[0].name.split('.')[0] for n in ast.walk(tree) if isinstance(n,ast.Import)}|{(n.module or '').split('.')[0] for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)})
  files.append(entry)
 for name in r['files']:
  if name.endswith('.py') or name=='alicactl':add(name,(B/name).read_bytes())
 with tarfile.open(B/'doghouse-dsh.tar') as t:
  for m in t:
   if m.isdir():continue
   require(m.isfile() and not Path(m.name).is_absolute() and '..' not in Path(m.name).parts,'Unsafe host-code archive member')
   add(m.name,t.extractfile(m).read())
 (O/'host-code-inventory.json').write_text(json.dumps({'releaseSha256':RELEASE,'doghouseArchiveSha256':sha(B/'doghouse-dsh.tar'),'files':files,'legalCoverageComplete':False},indent=2)+'\n')
 after=snapshot();require(after==before,'Container/image state changed during read-only audit')
 report.update({'hostCodeInventorySha256':sha(O/'host-code-inventory.json'),'hostCodeFiles':len(files),'containersUnchanged':True,'containerCount':len(before['containers']),'imagesUnchanged':True,'qaRemainedQuiesced':True,'completed':True});save();print(json.dumps({'completed':True,'images':len(images),'hostCodeFiles':len(files),'containersUnchanged':True,'stage74Accepted':False}),flush=True)
if __name__=='__main__':main()
