"""Read-only completion of attempt 2 after the aggregate-response reader limit."""
import json,subprocess,time
from qa_common import *
start=json.loads((OUT/'qualified-recurring-start.json').read_text());m=json.loads((OUT/'qualified-recurring-native-final.json').read_text());trace=json.loads((OUT/'qualified-attempt2-runtime-trace.json').read_text())
assert trace[0]['nativeCronCreated'] and trace[0]['id']==start['id']==m['id']
phases=[r for r in trace if 'elapsed' in r];assert phases[-1]['phase']=='completed' and phases[-1]['events']==8
elapsed=phases[-1]['elapsed'];assert elapsed>=1800 and [r['elapsed'] for r in phases]==sorted(r['elapsed'] for r in phases)
cmd=['docker','exec','-i','--user','10000:10001',CELL+'-hermes-1','env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python']
def native(args,body):
 p=subprocess.run(cmd+args,input=json.dumps(body),capture_output=True,text=True,check=True,timeout=40);return json.loads(p.stdout)
assert native(['/opt/unify-adapter/application-runtime/workflow.py','status'],{'id':m['id']})==m
assert m['phase']=='completed' and len(m['events'])==8 and all(e.get('completedAt') for e in m['events'])
assert len({e['requestId'] for e in m['events']})==len({e['receiptId'] for e in m['events']})==8
wall=max(e['completedAt'] for e in m['events'])-start['startedAt'];assert wall>=1800
restart=json.loads((OUT/'qualified-recurring-restart.json').read_text());assert restart['nativeRestartPreservedCheckpoint'] and any(r.get('nativeRestartPreservedCheckpoint') for r in trace)
authority=native(['-c',"import json,sys;from pathlib import Path;from cron import jobs;sys.path.insert(0,'/opt/unify-adapter/application-runtime');import workflow;c=workflow.Coordinator();m=json.loads(c.task(json.load(sys.stdin)['id']).body);j=jobs.get_job(m['cronId']);print(json.dumps({'nativeTaskDone':c.task(m['id']).status=='done','nativeCronPaused':not j['enabled'],'nativeCronRunCount':j['repeat']['completed'],'nativeCapabilityRemoved':not(Path('/opt/data/workflow-secrets')/m['id']).exists()}));c.close()"],{'id':m['id']})
assert authority['nativeTaskDone'] and authority['nativeCronPaused'] and authority['nativeCapabilityRemoved'] and authority['nativeCronRunCount']>=3
old=json.loads((OUT/'qualified-recurring-core-receipts.json').read_text());old={d['receipt']['id']:d['receipt'] for d in old}
for e in m['events']:
 s,d,_=backend('/api/v1/application/requests/'+e['receiptId']);assert s==200 and d['receipt']['phase']=='result-ready' and d['receipt']['result']==old[e['receiptId']]['result']
s,d,h=http(APP,'/api/login','POST',{'username':'alice','password':json.loads((OUT/'customer-passwords.json').read_text())['alice']},{'Origin':APP});assert s==200
s,p,_=http(APP,'/api/state',headers={'Origin':APP,'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':d['csrf']});assert s==200
owned={r['id']:r for r in p['requests']}
assert all(owned[e['requestId']]['state']=='result-ready' and not owned[e['requestId']]['result']['uncertainty'] and owned[e['requestId']]['result']['knowledge'] for e in m['events'])
report={'passed':True,'qualifiedAttempt':2,'elapsedSeconds':elapsed,'wallCompletionSeconds':round(wall,3),'successfulRecurringResults':8,'uniqueAppRequests':8,'uniqueCoreReceipts':8,'nativeRestartPreservedCheckpoint':True,'nativeAuthority':authority,'allResultsCertainAndGoverned':True,'nativeFinalUnchanged':True,'coreResultsUnchanged':True,'clockOrOutcomeEdits':False,'originalFinalProbeFailed':True,'resolution':'Read-only final verification with a bounded 4 MiB aggregate-state reader; original failed log retained','providerCost':m['providerCost'],'providerCostIsMeasured':False,'dayOrWeekSoakClaim':False}
(OUT/'qualified-recurring-soak.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
