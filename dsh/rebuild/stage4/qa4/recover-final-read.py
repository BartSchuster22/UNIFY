#!/usr/bin/env python3
"""Recover only QA4's expired-session final read. Never rerun or edit execution outcomes."""
import json,subprocess
from qa_common import *
m=json.loads((OUT/'recurring-native-final.json').read_text());start=json.loads((OUT/'recurring-start.json').read_text());closed=json.loads((OUT/'recurring-closeout.json').read_text())
assert closed['allRecurringResultsCertainAndGoverned'] and closed['nativeOwnerConfirmsAllRecurringKnowledgeReuse']
assert m['phase']=='completed' and len(m['events'])==4 and all(e['state']=='result-ready' and e['completedAt'] for e in m['events'])
assert len({e['requestId'] for e in m['events']})==len({e['receiptId'] for e in m['events']})==4
elapsed=m['finishedAt']-start['startedAt'];assert elapsed>=360
code="""import json,sys;sys.path.insert(0,'/opt/unify-adapter/application-runtime');import workflow;from cron import jobs;c=workflow.Coordinator();m=json.loads(c.task(json.load(sys.stdin)['id']).body);j=jobs.get_job(m['cronId']);print(json.dumps({'nativeTaskDone':c.task(m['id']).status=='done','nativeCronPaused':not j['enabled'],'nativeCronRunCount':j['repeat']['completed'],'nativeCapabilityRemoved':not (c.home/'workflow-secrets'/m['id']).exists(),'version':m['version']}));c.close()"""
p=subprocess.run(['docker','exec','-i','--user','10000:10001','dsh2-stage4-qa4-hermes-1','/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],input=json.dumps({'id':m['id']}),capture_output=True,text=True,timeout=40);assert p.returncode==0
n=json.loads(p.stdout);assert n['nativeTaskDone'] and n['nativeCronPaused'] and n['nativeCapabilityRemoved'] and n['nativeCronRunCount']>=3 and n['version']==m['version']
r={'passed':True,'allResultsCertainAndGoverned':True,'clockOrOutcomeEdits':False,'elapsedSeconds':round(elapsed,3),'durationSource':'persisted native finishedAt minus saved wall-clock run startedAt; not reconstructed monotonic timing','successfulRecurringResults':4,'uniqueAppRequests':4,'uniqueCoreReceipts':4,'nativeRestartPreservedCheckpoint':json.loads((OUT/'recurring-restart.json').read_text())['nativeRestartPreservedCheckpoint'],'nativeAuthority':n,'missedSlotsCoalesced':m['missedCoalesced'],'estimatedReservedMicros':m['estimatedReservedMicros'],'providerCost':m['providerCost'],'providerCostIsMeasured':False,'realModelInference':True,'dayOrWeekSoakClaim':False,'finalReadRecovery':'Original harness completed execution but its browser session expired. Separate reauthenticated closeout verified all four app/Core/native results. No execution data changed.'}
assert r['nativeRestartPreservedCheckpoint']
(OUT/'recurring-soak.json').write_text(json.dumps(r,indent=2));print(json.dumps(r))
