import json,os,subprocess,sys
from hermes_cli import kanban_db as k
qa=sys.argv[1];assert qa.startswith('qa-step7a-') and '/' not in qa and os.getuid()==10000
with k.connect_closing(k.kanban_db_path(board=qa)) as c:
 row=c.execute("SELECT id FROM tasks WHERE title='Step 7A verified interrupted work'").fetchone();assert row
 task=k.get_task(c,row[0]);assert task.status=='blocked' and task.max_retries==1 and not k.list_runs(c,task.id)
p=subprocess.run(['hermes','kanban','--board',qa,'promote',task.id],capture_output=True,text=True,timeout=60);assert p.returncode==0,p.stderr
print(json.dumps({'nativePromotion':True,'taskId':task.id,'stdout':p.stdout.strip()}))
