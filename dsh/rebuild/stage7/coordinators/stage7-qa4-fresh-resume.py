import json,os,sys
from pathlib import Path
os.umask(0o077)
REPO=Path('/home/herman/stage3-publication/repos/UNIFY');sys.path.insert(0,str(REPO/'dsh/rebuild/stage7'));import run_acceptance as q
q.OUT=REPO/'dsh/rebuild/stage7/evidence/candidates/72297c3/fresh-os-live';q.REPORT=json.loads((q.OUT/'progress.json').read_text());assert any(x['name']=='clean_install' and x['exitCode']==0 for x in q.REPORT['stages'])
q.stage('oidc','sudo -n python3 -B /srv/alica-stage7-qa4/oidc.py')
auth=json.loads(Path('/home/herman/.hermes/auth.json').read_text());tokens=[r['access_token'] for r in auth['credential_pool']['openai-codex'] if r.get('access_token')];assert len(tokens)==1
q.stage('native_provider','sudo -n python3 -B /srv/alica-stage7-qa4/native_provision.py',json.dumps({'access_token':tokens[0]}));tokens.clear();auth.clear()
q.stage('reference_image','sudo -n docker load -i /srv/alica-stage7-72297c3/bundle/reference-image.tar')
for name in ['setup_reference','first_request','operations_api','isolation','multi_fact_reuse','application_lifecycle','admission_negatives','recurring_soak']:
 q.stage(name,'sudo -n python3 -B /srv/alica-stage7-qa4/'+name+'.py',timeout=7800 if name=='recurring_soak' else 1800)
q.REPORT['qa4RecurrenceExecuted']=True
q.REPORT['remaining']=['host-faults','business-faults','hostile-boundary','browser','owner-recovery','real-reboot','cold-restore','signed-update','privacy','final-evidence-and-publication'];q.save()
print('QA4 bootstrap and live recurrence completed; remaining gates explicit',flush=True)
