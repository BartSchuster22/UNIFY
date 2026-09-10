"""Real pinned native DB/cron APIs; transport is explicitly mocked in this suite."""
import datetime as dt,json,os,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import workflow as f
class FakeRemote:
    def __init__(self,info):self.info=info;self.requests={};self.posts=0;self.loss=False
    def call(self,method,path=''):
        if not path:return self.info
        key=path.split('/')[2]
        if path.endswith('/cancel'):
            if key in self.requests:self.requests[key]['state']='deleted'
        elif method=='POST':
            if key not in self.requests:self.posts+=1;self.requests[key]={'id':str(uuid.uuid4()),'receiptId':str(uuid.uuid4()),'state':'pending'}
            if self.loss:self.loss=False;raise OSError('mocked lost response after commit')
        return {'request':self.requests.get(key)}
class NativeWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'HERMES_HOME':self.tmp.name});self.env.start()
        self.c=f.Coordinator();self.ctx=self.c.jobs.use_cron_store(self.tmp.name);self.ctx.__enter__()
        pc=self.c.store.projects.connect()
        try:self.c.store.projects.create_project(pc,name='Workflow fixture',slug='wf-fixture')
        finally:pc.close()
        self.id_=str(uuid.uuid4());self.info={'grantId':self.id_,'applicationId':str(uuid.uuid4()),'subject':'alice','projectId':'wf-fixture','maxRuns':10,'minIntervalSeconds':60}
        self.remote=FakeRemote(self.info);self.transport=patch.object(f,'Transport',return_value=self.remote);self.transport.start()
        self.spec={'grantId':self.id_,'token':'fixture-only-'+'x'*40,'intervalSeconds':60,'timezone':'Europe/Madrid','maxRuns':2,'estimatedUnitMicros':100,'maxEstimatedMicros':200,'noProgressSeconds':600}
        self.c.create(self.spec)
    def tearDown(self):self.transport.stop();self.ctx.__exit__(None,None,None);self.c.close();self.env.stop();self.tmp.cleanup()
    def state(self):return json.loads(self.c.task(self.id_).body)
    def test_native_cron_binding_and_sticky_ownership(self):
        m=self.state();j=self.c.jobs.get_job(m['cronId']);self.assertTrue(j['no_agent']);self.assertEqual(j['deliver'],'local')
        for _ in range(30):self.c.k.recompute_ready(self.c.conn)
        self.assertIsNone(self.c.k.claim_task(self.c.conn,self.c.task(self.id_).id))
        self.assertEqual(self.c.task(self.id_).status,'blocked')
        self.c.create(self.spec);self.assertEqual(len(self.c.jobs.list_jobs(True)),1)
    def test_payload_drift_and_unbounded_limits_denied(self):
        for change in [{'maxRuns':True},{'tools':['terminal']},{'timezone':'wrong/zone'},{'maxEstimatedMicros':201},{'intervalSeconds':1}]:
            with self.subTest(change=change),self.assertRaises(Exception):self.c.create(self.spec|change)
    def test_lost_post_reconciles_without_second_effect(self):
        self.remote.loss=True;self.c.tick(self.id_);m=self.state();self.assertEqual(m['phase'],'awaiting');self.assertEqual(self.remote.posts,1)
        with patch.object(f.time,'time',return_value=m['nextAttempt']+1):self.c.tick(self.id_)
        self.assertEqual(self.remote.posts,1);self.assertEqual(len(self.state()['events']),1)
    def test_event_dedup_and_overlap(self):
        self.c.tick(self.id_,event='webhook-1');self.c.tick(self.id_,event='webhook-1');self.c.tick(self.id_,event='webhook-2')
        self.assertEqual(self.remote.posts,1)
        with f.w.lock(self.c.store.locks/('workflow-'+self.id_+'.lock'),False):self.assertIn('overlap',self.c.tick(self.id_))
    def test_estimate_budget_is_not_actual_spend(self):
        self.c.tick(self.id_);m=self.state();self.assertEqual(m['estimatedReservedMicros'],100);self.assertIsNone(m['providerCost'])
        self.remote.requests[m['active']]['state']='result-ready';self.c.tick(self.id_)
        t=self.c.task(self.id_);m=self.state();m['policy']['maxEstimatedMicros']=100;self.c.save(t,m)
        with patch.object(f.time,'time',return_value=m['nextDue']+1):self.c.tick(self.id_)
        self.assertEqual(self.state()['error'],'estimated_budget_exhausted');self.assertEqual(self.remote.posts,1)
    def test_cancel_active_and_pause_native_job(self):
        self.c.tick(self.id_);self.c.tick(self.id_,cancel=True);m=self.state()
        self.assertEqual(m['phase'],'cancelled');self.assertFalse(self.c.jobs.get_job(m['cronId'])['enabled']);self.assertFalse((self.c.home/'workflow-secrets'/self.id_).exists())
    def test_no_progress_has_explicit_outcome(self):
        self.c.tick(self.id_);m=self.state()
        with patch.object(f.time,'time',return_value=m['lastProgress']+601):self.c.tick(self.id_)
        self.assertEqual(self.state()['phase'],'exception');self.assertEqual(self.state()['error'],'no_progress')
    def test_clock_regression_fails_closed(self):
        with patch.object(f.time,'time',return_value=self.state()['lastClock']-5):self.c.tick(self.id_)
        self.assertEqual(self.state()['error'],'clock_regression')
    def test_missing_dependency_and_cross_scope_denied(self):
        s=self.spec|{'grantId':str(uuid.uuid4()),'dependsOn':str(uuid.uuid4())}
        self.remote.info=self.info|{'grantId':s['grantId']}
        with self.assertRaises(Exception):self.c.create(s)
    def test_dependency_waits_and_then_proceeds(self):
        other=str(uuid.uuid4());spec=self.spec|{'grantId':other,'dependsOn':self.id_};self.remote.info=self.info|{'grantId':other};self.c.create(spec)
        self.assertEqual(self.c.tick(other)['phase'],'waiting_dependency');self.assertEqual(self.remote.posts,0)
        t=self.c.task(self.id_);m=self.state();self.c.finish(t,m,'completed')
        self.assertEqual(self.c.tick(other)['phase'],'awaiting')
    def test_dst_uses_distinct_utc_slots_and_explicit_offsets(self):
        a=dt.datetime(2026,10,25,0,30,tzinfo=dt.timezone.utc).timestamp();b=a+3600
        self.assertNotEqual(f.occurrence(a,60,a),f.occurrence(a,60,b));self.assertNotEqual(f.display_time(a,'Europe/Madrid'),f.display_time(b,'Europe/Madrid'))
    def test_cancel_unknown_requires_authority_fence(self):
        self.remote.loss=True;self.c.tick(self.id_)
        with patch.object(self.remote,'call',return_value={'request':None,'cancelConfirmed':True}):self.c.tick(self.id_,cancel=True)
        self.assertEqual(self.state()['phase'],'cancelled')
    def test_idle_long_interval_does_not_time_out(self):
        t=self.c.task(self.id_);m=self.state();m['nextDue']=m['anchor']+3600;self.c.save(t,m)
        with patch.object(f.time,'time',return_value=m['anchor']+700):self.c.tick(self.id_)
        self.assertEqual(self.state()['phase'],'ready');self.assertEqual(self.remote.posts,0)
    def test_stale_checkpoint_compare_and_swap_fenced(self):
        t=self.c.task(self.id_);m=self.state();self.c.save(t,m)
        with self.assertRaises(Exception):self.c.save(t,m)
    def test_real_kernel_lock_released_after_process_death(self):
        import multiprocessing
        ready=multiprocessing.Event();path=self.c.store.locks/('workflow-'+self.id_+'.lock')
        def holder():
            with f.w.lock(path,False):ready.set();__import__('time').sleep(60)
        proc=multiprocessing.Process(target=holder);proc.start()
        try:
            self.assertTrue(ready.wait(5));self.assertIn('overlap',self.c.tick(self.id_))
        finally:proc.terminate();proc.join(5)
        self.assertEqual(self.c.tick(self.id_)['phase'],'awaiting')
    def test_missed_runs_coalesce_not_burst(self):
        m=self.state()
        with patch.object(f.time,'time',return_value=m['anchor']+300):self.c.tick(self.id_)
        self.assertEqual(self.remote.posts,1);self.assertEqual(self.state()['missedCoalesced'],5)
if __name__=='__main__':unittest.main()
