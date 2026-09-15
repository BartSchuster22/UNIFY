"""Isolated native DB/process acceptance. Never opens the development board DB."""
import os,sys,json,tempfile,subprocess,socket,time
from pathlib import Path
from hermes_cli import kanban_db as kb
with tempfile.TemporaryDirectory(prefix='step6-cancel-native-') as root:
 path=Path(root)/'kanban.db'
 env=dict(os.environ,HERMES_KANBAN_DB=str(path))
 children=[]
 try:
  with kb.connect_closing(path) as conn:
   ident=kb.create_task(conn,title='Disposable cancellation contract test',assignee='qa-cancel',initial_status='running',workspace_kind='dir',workspace_path=root)
   task=kb.claim_task(conn,ident,claimer=socket.gethostname()+':'+str(os.getpid()))
   assert task and task.current_run_id
   run=task.current_run_id
   worker_env=dict(env,HERMES_KANBAN_TASK=ident,HERMES_KANBAN_RUN_ID=str(run),HERMES_KANBAN_CLAIM_LOCK=task.claim_lock)
   # A real long-lived process and inherited child, not a simulated signal response.
   worker=subprocess.Popen([sys.executable,'-c','import subprocess,sys,time; p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(120)"]); print(p.pid,flush=True); time.sleep(120)'],env=worker_env,stdout=subprocess.PIPE,text=True,start_new_session=True)
   children.append(worker); descendant=int(worker.stdout.readline())
   unrelated=subprocess.Popen([sys.executable,'-c','import time; time.sleep(120)'],start_new_session=True);children.append(unrelated)
   with kb.write_txn(conn):
    conn.execute('UPDATE tasks SET worker_pid=? WHERE id=?',(worker.pid,ident))
    conn.execute('UPDATE task_runs SET worker_pid=? WHERE id=?',(worker.pid,run))
   def invoke(mode,rid=run):return subprocess.run([sys.executable,'/tmp/step6-cancellation-bridge.py','qa-cancel',ident,str(rid),mode],env=env,capture_output=True,text=True,timeout=35)
   stale=invoke('execute',run+1);assert stale.returncode!=0 and worker.poll() is None
   validated=invoke('validate');assert validated.returncode==0,validated.stderr
   assert worker.poll() is None and kb.get_task(conn,ident).status=='running'
   result=invoke('execute');assert result.returncode==0,result.stderr
   state=json.loads(result.stdout);assert state['terminationVerified'] and state['cancelled']
   worker.wait(timeout=5);assert unrelated.poll() is None
   assert not kb._pid_alive(descendant)
   task=kb.get_task(conn,ident);runs=kb.list_runs(conn,ident)
   assert task.status=='blocked' and task.worker_pid is None and task.current_run_id is None
   assert len(runs)==1 and runs[0].outcome=='cancelled'
   replay=invoke('execute');assert replay.returncode==0 and json.loads(replay.stdout)['replayed']
   kb.dispatch_once(conn,dry_run=True)
   assert kb.get_task(conn,ident).status=='blocked' and len(kb.list_runs(conn,ident))==1, {'status':kb.get_task(conn,ident).status,'runs':[(r.id,r.outcome,r.summary) for r in kb.list_runs(conn,ident)]}
   print(json.dumps({'nativeCancellation':'passed','staleRunRejected':True,'validationDidNotSignal':True,'workerAndChildTerminated':True,'unrelatedProcessPreserved':True,'parkedBlocked':True,'outcome':runs[0].outcome,'noRedispatch':True}))
 finally:
  for p in children:
   if p.poll() is None:p.kill()
   p.wait(timeout=5)
