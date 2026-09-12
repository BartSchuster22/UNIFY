"""Finish verified QA custody and prepare public artifacts; no automatic git push."""
import json,os,subprocess,time,sys,shlex
from pathlib import Path
os.umask(0o077)
REPO=Path('/home/herman/stage3-publication/repos/UNIFY');S=REPO/'dsh/rebuild/stage7';F=S/'evidence/candidates/72297c3/fresh-os-live';sys.path.insert(0,str(S));import run_acceptance as q
end=time.monotonic()+10000
while not (F/'exported-evidence.json').exists():
 p=Path('/proc/1768893/cmdline');assert p.exists() and b'stage7-qa4-fresh-tail.py' in p.read_bytes(),'Qualification stopped; no closure permitted'
 assert time.monotonic()<end,'Qualification deadline exceeded'
 time.sleep(10)
def run(args,timeout):subprocess.run(args,cwd=REPO,check=True,timeout=timeout)
run(['python3','-B',str(S/'finalize_qa4.py'),'--check-only'],60)
run(['python3','-B','/home/herman/stage7-preserve-qa4-fresh-final.py'],2400)
v=json.loads((F/'post-acceptance/post-privacy-safeguard.json').read_text())
assert all(v[k]['authenticationVerified'] and v[k]['contentsVerified'] and v[k]['manifestSha256']==v['receipt']['manifestSha256'] for k in ['elioVerification','developmentVerification'])
code="""import sys,json,subprocess
sys.path.insert(0,'/srv/alica-stage7-qa4');import cold_restore as r
r.guard()
names=list(r.NAMES)+[r.REFERENCE];states=json.loads(subprocess.check_output(['docker','inspect',*names]));assert len(states)==8 and all(not x['State']['Running'] for x in states)
units=['alica-'+r.CELL+'-'+x+'.service' for x in ['cell','broker','observer']]
subprocess.run(['systemctl','disable',*units],check=True,capture_output=True)
for u in units:
 assert subprocess.run(['systemctl','is-enabled',u],capture_output=True,text=True).stdout.strip()=='disabled'
 assert subprocess.run(['systemctl','is-active',u],capture_output=True,text=True).stdout.strip()=='inactive'
print(json.dumps({'allEightStopped':True,'operationUnitsDisabled':True,'afterVerifiedSafeguards':True}))
"""
p=subprocess.run(q.SSH+['sudo -n python3 -B -c '+shlex.quote(code)],capture_output=True,text=True,check=True,timeout=60)
quiet=json.loads(p.stdout);(F/'post-acceptance/quiesced.json').write_text(json.dumps(quiet,indent=2)+'\n')
run(['python3','-B',str(S/'prepare_qa4_publication.py')],60)
print('Verified qualification, dual safeguards, and quiescence; publication artifacts prepared. Git publication still required.',flush=True)
