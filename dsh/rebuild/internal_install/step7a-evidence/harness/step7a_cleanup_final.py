import json,os,shutil,subprocess,sys
from pathlib import Path
from hermes_cli import kanban_db as k
qa=sys.argv[1];assert qa=='qa-step7a-bc19e389'
assert os.getuid()==Path('/opt/data').stat().st_uid
assert len(sys.argv)==3 and sys.argv[2].startswith('t_')
expected={'t_65b0f9e6','t_fa001583','t_903a737c',sys.argv[2]}
with k.connect_closing(k.kanban_db_path(board=qa)) as c:
 tasks=[k.get_task(c,r[0]) for r in c.execute('SELECT id FROM tasks')]
 assert {t.id for t in tasks}==expected
 assert all(t.status in ['done','blocked'] and t.worker_pid is None and t.current_run_id is None for t in tasks)
 assert all(len(k.list_runs(c,t.id))==1 for t in tasks)
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:env=(p/'environ').read_bytes()
 except OSError:continue
 assert ('HERMES_KANBAN_BOARD='+qa).encode()+b'\0' not in env, 'Disposable worker still live'
def run(*args):
 r=subprocess.run(['hermes',*args],capture_output=True,text=True,timeout=60);assert r.returncode==0,(args,r.stderr);return r.stdout
for task in tasks:run('kanban','--board',qa,'archive',task.id)
run('kanban','boards','rm',qa)
run('profile','delete',qa,'-y')
workspace=Path('/opt/data/workspace')/qa;assert workspace.is_dir() and not workspace.is_symlink();shutil.rmtree(workspace)
Path('/tmp/step7a-current.json').unlink(missing_ok=True)
assert not (Path('/opt/data/profiles')/qa).exists() and not workspace.exists()
print(json.dumps({'qa':qa,'archivedTaskIds':[t.id for t in tasks],'oneRunPerTask':True,'boardRecoverablyArchived':True,'disposableProfileAndCredentialsRemoved':True,'disposableWorkspaceRemoved':True,'noLiveDisposableWorker':True}))
