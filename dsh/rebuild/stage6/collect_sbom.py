"""Collect real SPDX image SBOMs on DSH2. Does not build or start containers."""
import hashlib,json,os,socket,subprocess,time
from pathlib import Path
assert os.geteuid()==0 and socket.gethostname()=='DSH2'
base=Path('/var/lib/alica-stage6-recovery/sboms');base.mkdir(mode=0o700,exist_ok=True)
tmp=base/'scanner-tmp';tmp.mkdir(mode=0o700,exist_ok=True)
scanner_env={**os.environ,'TMPDIR':str(tmp)}
scanner=Path('/usr/local/lib/alica-recovery-stage6/syft')
def digest(p):
 with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
release=Path('/srv/alica-dsh-qa/stage5-package-qa5/release.json');assert digest(release)=='1fde4fdfeea219bbad1e61e6bcce8046b2a7f9d880218d95a660624be08cd4f6'
r=json.loads(release.read_text());images={k:v['id'] for k,v in r['images'].items()};images['reference-application']='sha256:453f59474c73eda86bdb3dcdcaebb0928bf593c86700da9a9ad2449ed52dec61'
version=subprocess.check_output([str(scanner),'version','-o','json'],text=True);scanner_version=json.loads(version)
report={'schema':'stage6-observed-image-sboms/v1','generator':scanner_version,'generatorBinarySha256':digest(scanner),'releaseSha256':digest(release),'sourceRevisionDeclarations':r['source_revisions'],'provenanceScope':'Observed exact accepted QA5 release/image materials; not a claim of reproducible upstream builds or SLSA certification','images':{},'wholeStage6Accepted':False}
for name,image in images.items():
 path=base/(name+'.spdx.json');start=time.monotonic()
 if path.exists():
  assert path.stat().st_size==0,'Nonempty SBOM requires receipt validation, not overwrite'
  path.rename(base/(name+'.failed-empty-'+str(time.time_ns())+'.json'))
 with (base/(name+'.private.log')).open('w') as log:
  os.chmod(log.name,0o600);p=subprocess.run([str(scanner),'scan','docker:'+image,'-o','spdx-json='+str(path)],stdout=log,stderr=subprocess.STDOUT,timeout=900,env=scanner_env)
 assert p.returncode==0,'SBOM scan failed: '+name
 data=json.loads(path.read_text());assert data['spdxVersion']=='SPDX-2.3' and data.get('packages') and data.get('documentNamespace')
 report['images'][name]={'imageId':image,'file':path.name,'sha256':digest(path),'packages':len(data['packages']),'seconds':round(time.monotonic()-start,3)}
 (base/'receipt.json').write_text(json.dumps(report,indent=2));print(json.dumps({'image':name,**report['images'][name]}),flush=True)
print(json.dumps({'sbomsCompleted':len(report['images']),'wholeStage6Accepted':False}),flush=True)
