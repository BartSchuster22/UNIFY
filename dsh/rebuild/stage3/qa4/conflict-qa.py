#!/usr/bin/env python3
"""Real changed-quote correction quarantine; no synthetic provider responses."""
import json,subprocess,time,uuid
from qa_common import *
if (OUT/'conflict-acceptance.json').exists():raise SystemExit(0)
reg=json.loads((OUT/'registration.json').read_text());aid=str(uuid.UUID(reg['applicationId']));first=json.loads((OUT/'first-result.json').read_text());target=json.loads((OUT/'correction-result.json').read_text())
passage=next(p for p in first['result']['knowledge'][0]['source']['excerpt'].split('\n\n') if 'sure to be invalid' in p)
name='dsh2-stage3-qa4-memory-v4-1';meta=json.loads(subprocess.check_output(['docker','inspect',name]))[0];assert meta['Config']['Labels']['com.docker.compose.project']=='dsh2-stage3-qa4'
def canonical():
 code="import sqlite3,json;d=sqlite3.connect('/data/memoryv4.sqlite3');print(json.dumps(d.execute(\"SELECT id FROM records WHERE role='canonical' AND lifecycle='live' AND json_extract(attrs_json,'$.applicationId')=? AND json_extract(attrs_json,'$.subject')='customer-a' ORDER BY id\",('"+aid+"',)).fetchall()));d.close()"
 return json.loads(subprocess.check_output(['docker','exec',name,'python','-c',code]))
before=canonical();assert before
pw=json.loads((OUT/'customer-passwords.json').read_text());s,d,h=http(APP,'/api/login','POST',{'username':'alice','password':pw['alice']},{'Origin':APP});assert s==200
headers={'Cookie':h['Set-Cookie'].split(';',1)[0],'Origin':APP,'X-CSRF-Token':d['csrf']}
p=OUT/'conflict-input.json'
if p.exists():v=json.loads(p.read_text())
else:
 v={'key':str(uuid.uuid4()),'operation':'correction','corrects':target['id'],'question':'Propose a correction to the prior reservation-list finding using ONLY this different RFC passage. Return one finding quoting this entire passage exactly: '+passage};p.write_text(json.dumps(v))
s,r,_=http(APP,'/api/requests','POST',v,headers);assert s==202
end=time.monotonic()+220
while time.monotonic()<end:
 s,d,_=http(APP,'/api/state',headers=headers);assert s==200
 r=next(x for x in d['requests'] if x['id']==r['id'])
 if r['state']=='result-ready':break
 assert r['state'] not in ('rejected','cancelled','deleted'),r;time.sleep(1)
(OUT/'conflict-result.json').write_text(json.dumps(r,indent=2))
assert r['state']=='result-ready' and r['result']['quarantined']>=1 and r['result']['uncertainty'] is True and not r['result']['knowledge'],r
assert canonical()==before
report={'realChangedQuoteCorrectionQuarantined':True,'canonicalKnowledgeUnchanged':True,'uncertaintyVisible':True,'receiptId':r['receiptId']}
(OUT/'conflict-acceptance.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
