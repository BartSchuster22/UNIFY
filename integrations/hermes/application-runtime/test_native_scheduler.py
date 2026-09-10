#!/usr/bin/env python3
"""Real pinned Hermes SDK scheduler regression; no model calls, no network."""
import importlib.util,json,os,uuid
from pathlib import Path
assert os.environ['HERMES_HOME']=='/native-home'
spec=importlib.util.spec_from_file_location('worker','/fixture/worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
from hermes_cli import projects_db
p=projects_db.connect();projects_db.create_project(p,name='Scheduler regression',slug='scheduler-qa');p.close()
s=w.NativeStore();checks=[]
original=s.k.create_task
def interleaved(conn,**kw):
 id=original(conn,**kw)
 assert s.k.get_task(conn,id).status=='triage'
 # Force the scheduler into the exact gap between native admission and handoff.
 s.k.recompute_ready(conn)
 assert s.k.get_task(conn,id).status=='triage'
 checks.append('creation_gap_non_dispatchable')
 return id
s.k.create_task=interleaved
scope={'receiptId':str(uuid.uuid4()),'applicationId':str(uuid.uuid4()),'projectId':'scheduler-qa','subject':'test-customer'}
t=s.create(scope)
assert t.status=='blocked' and s.k._has_sticky_block(s.conn,t.id)
checks.append('native_sticky_handoff')
for _ in range(30):
 s.k.recompute_ready(s.conn)
 assert s.find(scope).status=='blocked'
 assert w.envelope(s.find(scope),scope)['state']=='running'
checks.append('thirty_native_scheduler_sweeps_preserve_running_observation')
assert s.k.claim_task(s.conn,t.id) is None
checks.append('general_worker_cannot_claim')
ref=w.scope(scope)|{'taskId':t.id,'sessionId':t.session_id}
s.settle(t,{'state':'cancelled','reference':ref,'error':'execution_stopped'})
assert w.envelope(s.find(scope),scope)['state']=='cancelled'
checks.append('native_settlement')
s.erase(s.find(scope),scope);assert s.find(scope) is None
checks.append('native_erasure')
s.close();print(json.dumps({'passed':True,'checks':checks,'nativeSdk':True,'inference':False}))
