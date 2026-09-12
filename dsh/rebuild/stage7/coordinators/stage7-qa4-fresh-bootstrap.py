"""Fresh QA4 bootstrap and live recurrence; never inherits a predecessor PASS."""
import json,os,subprocess,sys,tarfile,urllib.request,shlex,hashlib
from pathlib import Path
os.umask(0o077)
REPO=Path('/home/herman/stage3-publication/repos/UNIFY');sys.path.insert(0,str(REPO/'dsh/rebuild/stage7'));import run_acceptance as q
q.OUT=REPO/'dsh/rebuild/stage7/evidence/candidates/72297c3/fresh-os-live';q.OUT.mkdir();q.EXPECTED='1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c';q.REPORT={'schema':'stage7-qa4-live-run/v1','releaseSha256':q.EXPECTED,'stages':[],'passed':False,'productionAccepted':False};q.save()
plan=json.loads(Path('/home/herman/.alica-provider-access/stage7-qa4-fresh-os/stage7-rebuild-plan.json').read_text());assert plan['phase']=='fresh-os-ready' and plan['previousQa4StateAbsent'] and plan['emptyDockerVerified'];(q.OUT/'fresh-os.json').write_text(json.dumps(plan,indent=2))
url='https://github.com/BartSchuster22/Alica-DSH/releases/download/dsh-stage7-qa4-72297c3/public-download-verification.json'
with urllib.request.urlopen(url,timeout=60) as response:publication=json.load(response)
assert publication['anonymousHttpsDownload'] and publication['archiveSha256Verified'] and publication['sha256']=='26f98d6ffc8ecc576628b061a9851b8cd40e1e917f070a8567b9fb48ee969553'
(q.OUT/'publication.json').write_text(json.dumps(publication,indent=2))
archive=Path('/home/herman/stage7-qa4-fresh-tools.tar');assert not archive.exists()
with tarfile.open(archive,'w') as t:
 for p in sorted((REPO/'dsh/rebuild/stage7/qa4').iterdir()):
  if p.is_file():t.add(p,arcname=p.name)
(q.OUT/'qa-tool-archive.json').write_text(json.dumps({'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'noPredecessorRuntimeResultsImported':True}))
scp=['scp','-o','UserKnownHostsFile=/home/herman/.alica-provider-access/dsh2-stage7-known-hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519']
subprocess.run(scp+[str(archive),'deploy@95.216.216.143:/home/deploy/'],check=True)
q.stage('stage_qa_tools',"sudo -n mkdir -m 755 /srv/alica-stage7-qa4 && sudo -n tar -xf /home/deploy/stage7-qa4-fresh-tools.tar -C /srv/alica-stage7-qa4")
q.stage('clean_install','sudo -n python3 -B /srv/alica-stage7-qa4/clean_install.py',timeout=2000)
subprocess.run(['python3','-B',str(REPO/'dsh/rebuild/stage7/enroll_qa4.py')],check=True,timeout=60)
q.stage('oidc','sudo -n python3 -B /srv/alica-stage7-qa4/oidc.py')
auth=json.loads(Path('/home/herman/.hermes/auth.json').read_text());tokens=[r['access_token'] for r in auth['credential_pool']['openai-codex'] if r.get('access_token')];assert len(tokens)==1
q.stage('native_provider','sudo -n python3 -B /srv/alica-stage7-qa4/native_provision.py',json.dumps({'access_token':tokens[0]}));tokens.clear();auth.clear()
q.stage('reference_image','sudo -n docker load -i /srv/alica-stage7-72297c3/bundle/reference-image.tar')
for name in ['setup_reference','first_request','operations_api','isolation','multi_fact_reuse','application_lifecycle','admission_negatives','recurring_soak']:
 q.stage(name,'sudo -n python3 -B /srv/alica-stage7-qa4/'+name+'.py',timeout=7800 if name=='recurring_soak' else 1800)
q.REPORT['qa4RecurrenceExecuted']=True
q.REPORT['remaining']=['host-faults','business-faults','hostile-boundary','browser','owner-recovery','real-reboot','cold-restore','signed-update','privacy','final-evidence-and-publication'];q.save()
print('QA4 bootstrap and live recurrence completed; remaining gates explicit',flush=True)
