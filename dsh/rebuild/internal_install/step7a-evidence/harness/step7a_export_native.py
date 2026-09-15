import csv,dataclasses,hashlib,json,sqlite3,sys
from pathlib import Path
from hermes_cli import kanban_db as kb
qa=sys.argv[1];assert qa.startswith('qa-step7a-') and '/' not in qa
home=Path('/opt/data/profiles')/qa;workspace=Path('/opt/data/workspace')/qa
with kb.connect_closing(kb.kanban_db_path(board=qa)) as c:
 ids=[r[0] for r in c.execute('SELECT id FROM tasks ORDER BY created_at')]
 tasks={i:{'task':dataclasses.asdict(kb.get_task(c,i)),'runs':[dataclasses.asdict(r) for r in kb.list_runs(c,i)],'events':[dict(r) for r in c.execute('SELECT kind,payload,created_at,run_id FROM task_events WHERE task_id=? ORDER BY id',(i,))]} for i in ids}
sessions=[]
for db in [home/'state.db',Path('/opt/data/state.db')]:
 if not db.exists():continue
 conn=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True);conn.row_factory=sqlite3.Row
 cols={r[1] for r in conn.execute('PRAGMA table_info(sessions)')}
 wanted=[v for v in ['id','source','model','model_provider','profile','cwd','tool_call_count','api_call_count','billing_provider','profile_name','started_at','ended_at'] if v in cols]
 runids={(r.get('metadata') or {}).get('worker_session_id') for t in tasks.values() for r in t['runs']}
 for sid in runids:
  if not sid:continue
  row=conn.execute('SELECT '+','.join(wanted)+' FROM sessions WHERE id=?',(sid,)).fetchone()
  if row:sessions.append(dict(row))
 conn.close()
proof={'qa':qa,'tasks':tasks,'sessions':sessions,'missingFileAbsent':not (workspace/'intentionally-missing.csv').exists()}
result=workspace/'result.json'
if result.exists():
 content=result.read_text();data=json.loads(content)
 with (workspace/'input.csv').open() as f:rows=list(csv.DictReader(f))
 expected=sum(int(r['quantity'])*int(r['unit_price_cents']) for r in rows)
 assert data['total_cents']==expected
 for code in ['SOUL-STEP7A-ORCHID','MEMORY-STEP7A-CEDAR','USER-STEP7A-AMBER','SKILL-STEP7A-COBALT']:assert code in content,code
 proof.update({'artifact':data,'artifactSha256':hashlib.sha256(result.read_bytes()).hexdigest(),'independentlyCalculatedCents':expected})
proof['profileHashes']={str(p.relative_to(home)):hashlib.sha256(p.read_bytes()).hexdigest() for p in home.rglob('*') if p.is_file() and (p.name in ['config.yaml','profile.yaml','SOUL.md','MEMORY.md','USER.md','SKILL.md'])};proof['workspaceHashes']={str(p.relative_to(workspace)):hashlib.sha256(p.read_bytes()).hexdigest() for p in workspace.rglob('*') if p.is_file()};print(json.dumps(proof,indent=2))
