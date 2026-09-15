import json,os,subprocess,sys
from pathlib import Path
from hermes_cli import kanban_db as k
qa=sys.argv[1];assert qa.startswith('qa-step7a-') and '/' not in qa;assert os.getuid()==10000
w=Path('/opt/data/workspace')/qa
with k.connect_closing(k.kanban_db_path(board=qa)) as c:
 assert not c.execute("SELECT 1 FROM tasks WHERE title='Step 7A verified interrupted work'").fetchone()
 project=c.execute("SELECT project_id FROM tasks WHERE title='Step 7A browser file acceptance'").fetchone()[0];assert project
body="Lifecycle interruption acceptance only. Use the terminal tool to execute exactly this bounded command in your project workspace: python -c \"from pathlib import Path; import time; p=Path('verified-interruption-attempts.txt'); p.open('a').write('attempt\\n'); Path('verified-interruption-started.txt').write_text('STEP7A-VERIFIED-LIFECYCLE-SLEEP'); time.sleep(240); Path('verified-interruption-finished.txt').write_text('finished')\". Set terminal timeout to 300 seconds. Do not background, repeat, shorten or skip the sleep, and never write verified-interruption-finished.txt separately. Do not load the CSV skill for this task. The owner will stop and start the development cell while the command sleeps. Do not mark this task complete unless the command returns and the finished file actually exists. Work only in this workspace."
p=subprocess.run(['hermes','kanban','--board',qa,'create','Step 7A verified interrupted work','--body',body,'--assignee',qa,'--project',project,'--workspace','dir:'+str(w),'--initial-status','blocked','--max-retries','1','--max-runtime','420','--idempotency-key',qa+'-verified-interruption','--json'],capture_output=True,text=True,timeout=60)
assert p.returncode==0,p.stderr;d=json.loads(p.stdout);print(json.dumps({'qa':qa,'createdThroughNativeCLI':True,'explicitMaxRetries':1,'maxRuntimeSeconds':420,'created':d}))
