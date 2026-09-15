import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Run inside the pinned Hermes runtime, using its transaction/event/run ownership.
// No reclaim/promote sequence: the task never becomes ready during cancellation.
export const cancellationBridge = String.raw`
import sys,os,json,re,time,signal,socket
from pathlib import Path
from hermes_cli import kanban_db as kb
board,task_id,run_text,mode=sys.argv[1:]
if not all(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}',v) for v in [board,task_id]):raise ValueError('Invalid native identity')
run_id=int(run_text)
if run_id<1 or mode not in ['validate','execute']:raise ValueError('Invalid cancellation request')
path=kb.kanban_db_path(board=board)
if not path.is_file():raise ValueError('Board unavailable')
with kb.connect_closing(path) as conn:
 with kb.write_txn(conn):
  task=kb.get_task(conn,task_id)
  if task and task.status=='blocked' and task.current_run_id is None:
   runs=kb.list_runs(conn,task_id)
   if runs and runs[-1].id==run_id and runs[-1].outcome=='cancelled' and (runs[-1].metadata or {}).get('termination_verified'):
    print(json.dumps({'task':{'id':task_id,'status':'blocked'},'runId':run_id,'cancelled':True,'terminationVerified':True,'replayed':True}));sys.exit(0)
  if not task or task.status!='running' or task.current_run_id!=run_id:raise ValueError('Run changed; reload before cancelling')
  pid=task.worker_pid; lock=task.claim_lock
  if not pid or not lock or not lock.startswith(socket.gethostname()+':'):raise ValueError('Worker is not locally cancellable')
  expected={'HERMES_KANBAN_TASK':task_id,'HERMES_KANBAN_RUN_ID':str(run_id),'HERMES_KANBAN_CLAIM_LOCK':lock,'HERMES_KANBAN_DB':str(path)}
  def matches(pid):
   try:
    p=Path('/proc')/str(pid)
    if (p/'stat').read_text().split(') ',1)[1].split()[0]=='Z':return False
    env=dict(x.split(b'=',1) for x in (p/'environ').read_bytes().split(b'\0') if b'=' in x)
    return all(env.get(k.encode())==v.encode() for k,v in expected.items())
   except (FileNotFoundError,PermissionError,ProcessLookupError):return False
  if not matches(pid):raise ValueError('Worker process identity cannot be verified')
  if not hasattr(os,'pidfd_open') or not hasattr(signal,'pidfd_send_signal'):raise ValueError('Race-safe process signalling unavailable')
  if mode=='validate':print(json.dumps({'runId':run_id,'cancellable':True}));sys.exit(0)
  def matching_pids():
   # Only this exact native task/run/claim/board; environment values are never emitted.
   return [int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit() and matches(int(p.name))]
  stopped=set()
  deadline=time.monotonic()+8
  while True:
   pids=matching_pids()
   if not pids:break
   if time.monotonic()>deadline:raise ValueError('Worker termination not verified; no cancellation success')
   sig=signal.SIGKILL if time.monotonic()>deadline-4 else signal.SIGTERM
   for child in pids:
    try:
     fd=os.pidfd_open(child)
     try:
      if matches(child):signal.pidfd_send_signal(fd,sig);stopped.add(child)
     finally:os.close(fd)
    except ProcessLookupError:pass
   time.sleep(0.1)
  conn.execute("UPDATE tasks SET status='blocked', claim_lock=NULL, claim_expires=NULL, worker_pid=NULL WHERE id=? AND current_run_id=?",(task_id,run_id))
  ended=kb._end_run(conn,task_id,outcome='cancelled',status='blocked',summary='Cancelled by owner; worker termination verified',metadata={'cancelled':True,'termination_verified':True,'terminated_process_count':len(stopped)})
  if ended!=run_id:raise ValueError('Native run identity changed')
  kb._append_event(conn,task_id,'blocked',{'reason':'Owner cancelled this run; explicit resume required','kind':'needs_input','cancelled':True},run_id=run_id)
  kb._append_event(conn,task_id,'cancelled',{'termination_verified':True,'run_id':run_id},run_id=run_id)
 print(json.dumps({'task':{'id':task_id,'status':'blocked'},'runId':run_id,'cancelled':True,'terminationVerified':True}))
`;

export async function cancelNativeTask(boardId: string, taskId: string, runId: number, mode: 'validate' | 'execute') {
  const { stdout } = await promisify(execFile)('python3', ['-c', cancellationBridge, boardId, taskId, String(runId), mode], {timeout: 30_000, maxBuffer: 64 * 1024});
  return JSON.parse(stdout) as Record<string, unknown>;
}
