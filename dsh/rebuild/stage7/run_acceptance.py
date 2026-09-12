#!/usr/bin/env python3
"""Coordinate real QA3 acceptance, fail closed and preserve private logs.
No acceptance result is inherited. Never exports refresh credentials.
"""
import json,os,subprocess,time
from pathlib import Path
ROOT=Path(__file__).parent;OUT=ROOT/'evidence/candidates/2772d9c/live';EXPECTED='26ccaff3c5539288dda0a0e9b60fa7187fb64b70c772f104e1c0068efbed2b01'
SSH=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','UserKnownHostsFile=/home/herman/.alica-provider-access/dsh2-stage7-known-hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@95.216.216.143']
REPORT={'schema':'stage7-qa3-live-run/v1','releaseSha256':EXPECTED,'stages':[],'passed':False,'productionAccepted':False}
def save(): (OUT/'progress.json').write_text(json.dumps(REPORT,indent=2)+'\n')
def stage(name,command,data=None,timeout=1200):
 start=time.monotonic();p=subprocess.run(SSH+[command],input=data,text=True,capture_output=True,timeout=timeout)
 attempt=sum(r['name']==name for r in REPORT['stages'])+1
 (OUT/(name+('.attempt'+str(attempt) if attempt>1 else '')+'.private.log')).write_text(p.stdout+'\n'+p.stderr)
 row={'name':name,'attempt':attempt,'exitCode':p.returncode,'seconds':round(time.monotonic()-start,3)};REPORT['stages'].append(row);save();print(json.dumps(row),flush=True)
 assert p.returncode==0,'QA stage failed: '+name
 return p.stdout

def main():
 os.umask(0o077);OUT.mkdir(parents=True,exist_ok=True);assert not (OUT/'progress.json').exists();save()
 for attempt in range(150):
  p=subprocess.run(SSH+["sudo -n python3 -c \"import json;from pathlib import Path;p=Path('/var/lib/alica-stage7-qa3/clean-install.json');print(p.read_text() if p.exists() else '{}')\""],capture_output=True,text=True,timeout=30)
  if p.returncode==0:
   result=json.loads(p.stdout)
   if result:
    assert result['passed'] and result['releaseSha256']==EXPECTED,'Clean candidate gate did not pass';break
  time.sleep(5)
 else:raise RuntimeError('Clean-install readiness deadline exceeded')
 (OUT/'clean-install.json').write_text(json.dumps(result,indent=2)+'\n')
 stage('oidc','sudo -n python3 /srv/alica-stage7-qa/oidc.py')
 auth=json.loads(Path('/home/herman/.hermes/auth.json').read_text());rows=auth['credential_pool']['openai-codex'];tokens=[r['access_token'] for r in rows if r.get('access_token')];assert len(tokens)==1
 stage('native-provider','sudo -n python3 /srv/alica-stage7-qa/native_provision.py',json.dumps({'access_token':tokens[0]}));tokens.clear();auth.clear()
 stage('reference-image','sudo -n docker load -i /srv/alica-stage7-2772d9c/bundle/reference-image.tar')
 for name in ['setup_reference','first_request','operations_api','isolation','recurring_soak','host_operations','extended_host','business_faults']:
  stage(name,'sudo -n python3 /srv/alica-stage7-qa/'+name+'.py',timeout=1800)
 REPORT['passed']=True;REPORT['remaining']=['real-host-reboot','restore','update','final-evidence-review'];save()
 print(json.dumps(REPORT),flush=True)
if __name__=='__main__':main()
