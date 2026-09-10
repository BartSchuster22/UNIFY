#!/usr/bin/env python3
"""Native-owned recurring coordinator. No model, tools, provider or application DB here."""
import contextlib,datetime as dt,hashlib,http.client,ipaddress,json,os,re,socket,ssl,sys,time,uuid
from pathlib import Path
from zoneinfo import ZoneInfo
import worker as w
TERMINAL={'completed','cancelled','exception'}
class RemoteError(Exception):
    def __init__(self,status):self.status=status

def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'))
def integer(x,low,high):w.require(type(x) is int and low<=x<=high)
def occurrence(anchor,period,now):
    if now<anchor:return None
    return int((now-anchor)//period)
def display_time(stamp,zone):return dt.datetime.fromtimestamp(stamp,dt.timezone.utc).astimezone(ZoneInfo(zone)).isoformat()

class Transport:
    def __init__(self,home,id):
        self.home=home;self.id=id
        self.policy=json.loads((home/'workflow-policy.json').read_text())
        w.object_keys(self.policy,('origin','address'))
        self.url=w.url_parts(self.policy['origin']);w.require(not self.url.path and not self.url.query)
        ipaddress.ip_address(self.policy['address'])
        self.token=(home/'workflow-secrets'/id).read_text()
    def call(self,method,path=''):
        policy=self.policy;host=self.url.hostname
        ctx=ssl.create_default_context(cafile=str(self.home/'workflow-ca.crt'))
        class Pinned(http.client.HTTPSConnection):
            def connect(me):
                sock=socket.create_connection((policy['address'],443),timeout=8)
                try:me.sock=ctx.wrap_socket(sock,server_hostname=host)
                except BaseException:sock.close();raise
        conn=Pinned(host,443,timeout=8,context=ctx)
        try:
            conn.request(method,'/internal/recurring/'+self.id+path,body='{}' if method=='POST' else None,headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
            r=conn.getresponse();raw=r.read(16385);w.require(len(raw)<=16384)
            if r.status!=200:raise RemoteError(r.status)
            return w.decode(raw)
        finally:conn.close()

class Coordinator:
    def __init__(self):
        self.store=w.NativeStore();self.home=self.store.home;self.k=self.store.k;self.conn=self.store.conn
        from cron import jobs
        self.jobs=jobs
    def close(self):self.store.close()
    def task(self,id):
        w.require(w.uid(id))
        rows=self.conn.execute('SELECT id FROM tasks WHERE idempotency_key=?',('alica-workflow/v1:'+id,)).fetchall();w.require(len(rows)<=1)
        if not rows:return None
        t=self.k.get_task(self.conn,rows[0]['id']);w.require(t.created_by=='alica-workflow/v1')
        m=json.loads(t.body);w.require(m['id']==id and t.project_id==m['nativeProjectId'])
        return t
    def save(self,t,m):
        m['version']+=1
        with self.k.write_txn(self.conn):
            r=self.conn.execute('UPDATE tasks SET body=? WHERE id=? AND body=?',(canonical(m),t.id,t.body));w.require(r.rowcount==1)
            self.k._append_event(self.conn,t.id,'workflow_checkpoint',{'version':m['version'],'phase':m['phase'],'event':m.get('active'),'at':time.time()})
        return self.task(m['id'])
    def finish(self,t,m,phase,error=None):
        m['phase']=phase;m['error']=error;m['finishedAt']=time.time();t=self.save(t,m)
        if m.get('cronId'):self.jobs.pause_job(m['cronId'],reason='Bounded workflow '+phase)
        if phase!='exception' or not m.get('active'):
            (self.home/'workflow-secrets'/m['id']).unlink(missing_ok=True)
        current=self.k.get_task(self.conn,t.id)
        if current.status!='done':w.require(self.k.complete_task(self.conn,t.id,result=canonical({'state':phase,'error':error,'effectsSettled':not bool(m.get('active'))}),summary='Bounded workflow: '+phase))
        return m
    def create(self,spec):
        w.object_keys(spec,('grantId','token','intervalSeconds','timezone','maxRuns','estimatedUnitMicros','maxEstimatedMicros','noProgressSeconds'),('dependsOn','startAt'))
        id=spec['grantId'];w.require(w.uid(id) and w.text(spec['token'],128))
        integer(spec['intervalSeconds'],60,86400);w.require(spec['intervalSeconds']%60==0)
        integer(spec['maxRuns'],1,100);integer(spec['estimatedUnitMicros'],1,10**9);integer(spec['maxEstimatedMicros'],1,10**11);integer(spec['noProgressSeconds'],180,86400)
        ZoneInfo(spec['timezone']);w.require(spec.get('dependsOn') is None or w.uid(spec['dependsOn']))
        now=time.time();start=now
        if 'startAt' in spec:
            parsed=dt.datetime.fromisoformat(spec['startAt'].replace('Z','+00:00'));w.require(parsed.tzinfo is not None);start=parsed.timestamp();w.require(now-86400<=start<=now+2592000)
        fingerprint=hashlib.sha256(canonical(spec).encode()).hexdigest()
        with w.lock(self.store.locks/'workflow-admission.lock'):
            t=self.task(id)
            if t:
                m=json.loads(t.body);w.require(m['fingerprint']==fingerprint)
                if m['phase'] in TERMINAL:return m
            else:
                folder=self.home/'workflow-secrets';folder.mkdir(mode=0o700,exist_ok=True)
                path=folder/id
                if path.exists():w.require(path.read_text()==spec['token'])
                else:
                    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
                    with os.fdopen(fd,'w') as f:f.write(spec['token']);f.flush();os.fsync(f.fileno())
                info=Transport(self.home,id).call('GET')
                w.require(info['grantId']==id and spec['maxRuns']<=info['maxRuns'] and spec['intervalSeconds']>=info['minIntervalSeconds'])
                pc=self.store.projects.connect()
                try:project=self.store.projects.get_project(pc,info['projectId']);w.require(project is not None)
                finally:pc.close()
                if spec.get('dependsOn'):
                    dep=self.task(spec['dependsOn']);w.require(dep is not None);dm=json.loads(dep.body)
                    w.require(all(dm['scope'][k]==info[k] for k in ('applicationId','subject','projectId')))
                active=self.conn.execute("SELECT count(*) FROM tasks WHERE created_by='alica-workflow/v1' AND status!='done'").fetchone()[0];w.require(active<8)
                m={'id':id,'fingerprint':fingerprint,'nativeProjectId':project.id,'scope':{k:info[k] for k in ('applicationId','subject','projectId')},'policy':{k:v for k,v in spec.items() if k not in ('grantId','token')},'phase':'ready','version':0,'anchor':start,'nextDue':start,'createdAt':now,'lastProgress':now,'lastClock':now,'nextAttempt':0,'failures':0,'events':[],'active':None,'cronId':None,'missedCoalesced':0,'estimatedReservedMicros':0,'providerCost':None,'providerCostProvenance':'not available; admission estimates are not billing evidence'}
                tid=self.k.create_task(self.conn,title='Bounded recurring application '+id,body=canonical(m),tenant='alica-workflow/v1:'+canonical(m['scope']),created_by='alica-workflow/v1',initial_status='running',triage=True,workspace_kind='scratch',project_id=project.id,max_retries=1,skills=[],idempotency_key='alica-workflow/v1:'+id)
                t=self.task(id);w.require(t.id==tid)
            if t.status=='triage':
                with self.k.write_txn(self.conn):
                    self.conn.execute("UPDATE tasks SET status='blocked',block_kind='capability' WHERE id=? AND status='triage'",(t.id,))
                    self.k._append_event(self.conn,t.id,'blocked',{'kind':'capability','reason':'Native restricted recurring coordinator; no general-worker execution.'})
                t=self.task(id)
            scripts=self.home/'scripts';scripts.mkdir(mode=0o700,exist_ok=True);name='alica-workflow-'+id+'.py'
            content='import os,sys\nos.environ["HERMES_HOME"]='+repr(str(self.home))+'\nsys.path.insert(0,'+repr(str(Path(__file__).resolve().parent))+')\nimport workflow\nworkflow.main_tick('+repr(id)+')\n'
            script=scripts/name
            if script.exists():w.require(not script.is_symlink() and script.read_text()==content)
            else:script.write_text(content);script.chmod(0o600)
            jobs=[j for j in self.jobs.list_jobs(include_disabled=True) if j.get('script')==name];w.require(len(jobs)<=1)
            job=jobs[0] if jobs else self.jobs.create_job(prompt=None,schedule='every 1m',name='ALICA workflow '+id,script=name,no_agent=True,deliver='local')
            w.require(job.get('no_agent') is True and job.get('deliver')=='local')
            m['cronId']=job['id'];self.save(t,m);return m
    def tick(self,id,event=None,cancel=False,transport=None):
        w.require(w.uid(id))
        try:
            with w.lock(self.store.locks/('workflow-'+id+'.lock'),False):return self._tick(id,event,cancel,transport)
        except BlockingIOError:return {'id':id,'overlap':'skipped; current native owner retained'}
    def _tick(self,id,event,cancel,transport):
        t=self.task(id);w.require(t is not None);m=json.loads(t.body);now=time.time();p=m['policy']
        if m['phase'] in TERMINAL and not cancel:return m
        if cancel:
            m['phase']='cancelling';t=self.save(t,m)
            if m.get('cronId'):self.jobs.resume_job(m['cronId'])
        if now<m['lastClock']-2:return self.finish(t,m,'exception','clock_regression')
        m['lastClock']=now
        if event is not None:
            w.require(w.text(event,100) and re.fullmatch('[A-Za-z0-9_.:-]+',event))
            event='event:'+event
            if any(x['key']==event for x in m['events']):return m
            if m['active']:return m|{'eventNotAdmitted':'overlap'}
        if m['phase']=='cancelling' and not m['active']:return self.finish(t,m,'cancelled')
        if now<m['nextAttempt'] and not cancel:return m
        if (m['active'] or m['phase']=='waiting_dependency' or m['failures']) and now-m['lastProgress']>p['noProgressSeconds']:
            if m['active'] and m['phase']!='cancelling':
                m['phase']='cancelling';m['stopReason']='no_progress';m['lastProgress']=now;t=self.save(t,m)
            else:return self.finish(t,m,'exception','unsettled_no_progress' if m['active'] else 'dependency_no_progress')
        try:
            remote=transport or Transport(self.home,id)
            if m['active']:
                key=m['active'];entry=next(x for x in m['events'] if x['key']==key)
                if m['phase']=='cancelling':response=remote.call('POST','/events/'+key+'/cancel')
                else:
                    response=remote.call('GET','/events/'+key)
                    if response['request'] is None:response=remote.call('POST','/events/'+key)
                request=response['request']
                if request is None and m['phase']=='cancelling':
                    # A lost POST may have committed a reservation, but no app request.
                    # Do NOT turn cancellation into dispatch to resolve the ambiguity.
                    if response.get('cancelConfirmed') is True:
                        m['active']=None;return self.finish(t,m,'cancelled')
                    return self.finish(t,m,'exception','cancel_outcome_unknown')
                w.require(isinstance(request,dict) and w.uid(request['id']))
                w.require(entry.get('requestId') in (None,request['id']))
                if entry.get('state')!=request['state']:m['lastProgress']=now
                entry.update(requestId=request['id'],receiptId=request['receiptId'],state=request['state'],observedAt=now)
                if request['state']=='deleted' and m['phase']=='cancelling':
                    m['active']=None;return self.finish(t,m,'exception' if m.get('stopReason') else 'cancelled',m.get('stopReason'))
                if request['state']=='result-ready' and m['phase']!='cancelling':
                    entry['completedAt']=now;m['active']=None;m['phase']='ready';m['lastProgress']=now
                    m['nextDue']=max(m['nextDue'],entry.get('dueAt',now)+p['intervalSeconds'])
                    t=self.save(t,m)
                    if len(m['events'])>=p['maxRuns']:return self.finish(t,m,'completed')
                elif request['state'] in ('rejected','cancelled','deleted') and m['phase']!='cancelling':return self.finish(t,m,'exception','child_'+request['state'])
            else:
                dep=p.get('dependsOn')
                if dep:
                    task=self.task(dep);w.require(task is not None);dm=json.loads(task.body)
                    if dm['phase'] in ('exception','cancelled'):return self.finish(t,m,'exception','dependency_failed')
                    if dm['phase']!='completed':m['phase']='waiting_dependency';self.save(t,m);return m
                if len(m['events'])>=p['maxRuns']:return self.finish(t,m,'completed')
                if m['estimatedReservedMicros']+p['estimatedUnitMicros']>p['maxEstimatedMicros']:return self.finish(t,m,'exception','estimated_budget_exhausted')
                if event is None and now<m['nextDue']:self.save(t,m);return m
                slot=occurrence(m['anchor'],p['intervalSeconds'],now)
                due=m['anchor']+(slot or 0)*p['intervalSeconds'];key=event or 'slot:'+str(slot)
                if any(x['key']==key for x in m['events']):self.save(t,m);return m
                m['missedCoalesced']+=max(0,int((due-m['nextDue'])//p['intervalSeconds']))
                m['events'].append({'key':key,'dueAt':due,'localDueAt':display_time(due,p['timezone']),'admittedAt':now,'state':'dispatch-unknown'})
                m['active']=key;m['phase']='awaiting';m['estimatedReservedMicros']+=p['estimatedUnitMicros'];m['lastProgress']=now
                t=self.save(t,m) # Durable checkpoint and estimate reservation BEFORE any effect.
                response=remote.call('POST','/events/'+key)
                request=response['request'];w.require(isinstance(request,dict) and w.uid(request['id']))
                m['events'][-1].update(requestId=request['id'],receiptId=request['receiptId'],state=request['state'])
            m['failures']=0;m['nextAttempt']=0;self.save(t,m);return m
        except RemoteError as e:
            if e.status in (401,403,404):return self.finish(t,m,'exception','capability_revoked_or_invalid')
            if e.status==429:return self.finish(t,m,'exception','application_admission_limit')
            m['failures']+=1;m['nextAttempt']=now+min(300,15*2**min(m['failures'],5));m['lastError']='remote_http_failure';self.save(t,m);return m
        except (OSError,ValueError,http.client.HTTPException):
            m['failures']+=1;m['nextAttempt']=now+min(300,15*2**min(m['failures'],5));m['lastError']='transport_outcome_unknown';self.save(t,m);return m

def main_tick(id):
    c=None
    try:
        c=Coordinator();m=c.tick(id)
        print(canonical({'id':id,'phase':m.get('phase'),'version':m.get('version'),'error':m.get('error'),'overlap':m.get('overlap')}))
    except Exception:print('{"error":"native_workflow_exception; reconcile existing native card"}');raise SystemExit(1)
    finally:
        if c:c.close()

def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument('action',choices=('create','status','tick','event','cancel'));a=p.parse_args();c=None
    try:
        data=w.decode(sys.stdin.buffer.read(16385));w.require(isinstance(data,dict));c=Coordinator()
        if a.action=='create':out=c.create(data)
        else:
            w.object_keys(data,('id',),('eventKey',));w.require(w.uid(data['id']))
            if a.action=='status':task=c.task(data['id']);w.require(task is not None);out=json.loads(task.body)
            else:out=c.tick(data['id'],event=data.get('eventKey') if a.action=='event' else None,cancel=a.action=='cancel')
        print(canonical(out))
    except Exception:print('{"error":"native_workflow_rejected_or_unknown; reconcile by grantId"}');raise SystemExit(1)
    finally:
        if c:c.close()
if __name__=='__main__':main()
