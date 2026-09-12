"""DSH2-only retirement of the fully backed-up, unaccepted QA3 trial."""
import hashlib,json,os,subprocess
from pathlib import Path
CELL='dsh2-stage7-qa3';S=Path('/var/lib/alica-stage7-qa3-final-safeguard')
def run(*args):return subprocess.check_output(args,text=True).strip()
assert os.geteuid()==0 and run('hostname')=='DSH2'
h=hashlib.sha256()
with (S/'backup.age').open('rb') as f:
 for b in iter(lambda:f.read(1048576),b''):h.update(b)
assert h.hexdigest()=='6d7f8b78ef17bf0c1e3e84483df5ad60b4e98f999ee670afc82064dfefe54908'
proof=json.loads((S/'offhost-proof.json').read_text())
for key in ('elioVerification','developmentVerification'):
 v=proof[key];assert v['authenticationVerified'] and v['contentsVerified'] and v['ciphertextSha256']==h.hexdigest() and v['manifestSha256']=='9843ceccd86543b1560188fd04987cb9f20f57c2ed9f8ec4ba35e9e7229f4b39'
spec=json.loads((S/'spec.json').read_text());assert spec['quiesced'];m=spec['metadata'];assert m['cell']==CELL
assert not run('docker','ps','-q')
ids=run('docker','ps','-aq').split();rows=json.loads(run('docker','inspect',*ids));assert {r['Id'] for r in rows}==set(m['containerIdsBefore'].values())
for r in rows:
 assert not r['State']['Running']
 assert r['Config']['Labels'].get('com.alica.stage2')==CELL or r['Name']=='/dsh7-reference-qa3'
volumes=run('docker','volume','ls','-q').split();assert set(volumes)=={v['Name'] for v in m['volumes']}
assert all(v['Labels'].get('com.alica.stage2')==CELL for v in json.loads(run('docker','volume','inspect',*volumes)))
images=set(run('docker','image','ls','-aq','--no-trunc').split());assert images<={r['Image'] for r in rows}
units=['alica-'+CELL+'-'+role+'.service' for role in ('cell','broker','observer')]
run('systemctl','stop',*units);run('systemctl','disable',*units)
run('docker','rm',*ids);run('docker','volume','rm',*volumes)
networks=run('docker','network','ls','-q','--filter','label=com.docker.compose.project='+CELL).split()
if networks:run('docker','network','rm',*networks)
for image in images:run('docker','image','rm',image)
for args in [('ps','-aq'),('volume','ls','-q'),('image','ls','-aq')]:assert not run('docker',*args)
report={'schema':'stage7-qa3-retirement/v1','onlyVerifiedArchivedTrialRemoved':True,'cleanDockerVerified':True,'rootsAndEvidenceRetained':True,'ciphertextSha256':h.hexdigest(),'removedContainers':len(ids),'removedVolumes':len(volumes),'stage7Accepted':False}
(S/'retirement.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
