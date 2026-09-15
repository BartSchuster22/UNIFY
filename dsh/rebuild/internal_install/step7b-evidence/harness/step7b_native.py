import json,os,sys,subprocess,shutil
from pathlib import Path
from cron.jobs import list_jobs
mode,qa=sys.argv[1:3];assert qa.startswith('qa-step7b-') and '/' not in qa and os.getuid()==10000
w=Path('/opt/data/workspace')/qa
jobs=list_jobs(include_disabled=True)
def run(args):
 p=subprocess.run(['hermes','cron',*args],capture_output=True,text=True,timeout=60);assert p.returncode==0 and 'Failed to' not in p.stdout,(p.stderr,p.stdout);return p.stdout
if mode=='prepare':
 assert not jobs and not w.exists();w.mkdir(mode=0o700)
 (w/'probe.py').write_text("from pathlib import Path\nimport json,datetime,os\nw=Path(__file__).parent\nassert os.getuid()==10000\nevent={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'marker':'STEP7B-SCHEDULED-INVOCATION','pid':os.getpid()}\nwith (w/'attempts.jsonl').open('a') as f:f.write(json.dumps(event)+'\\n')\nprint(json.dumps(event))\n")
 print(json.dumps({'qa':qa,'initialJobs':jobs,'workspace':str(w),'script':(w/'probe.py').read_text()}));sys.exit()
matched=[j for j in jobs if j.get('name')==qa]
if mode=='cleanup':
 assert not matched and not jobs;assert w.is_dir() and not w.is_symlink();shutil.rmtree(w);(Path('/opt/data/scripts')/(qa+'.py')).unlink(missing_ok=True);print(json.dumps({'jobRemoved':True,'workspaceRemoved':not w.exists(),'scriptRemoved':not (Path('/opt/data/scripts')/(qa+'.py')).exists(),'remainingJobs':jobs}));sys.exit()
assert len(matched)==1,matched;j=matched[0];jid=j['id']
if mode=='bind':
 assert not j.get('enabled',True),j
 shim=Path('/opt/data/scripts')/(qa+'.py');assert not shim.exists();shim.parent.mkdir(exist_ok=True)
 shim.write_text('import runpy\nrunpy.run_path('+repr(str(w/'probe.py'))+', run_name="__main__")\n')
 print(json.dumps({'nativeCLI':run(['edit',jid,'--schedule','1m','--script',qa+'.py','--no-agent','--workdir',str(w),'--repeat','1'])}));sys.exit()
if mode=='due':
 assert not j.get('enabled',True),j
 print(json.dumps({'nativeCLI':run(['edit',jid,'--schedule','3m','--repeat','1'])}));sys.exit()
assert mode=='snapshot'
p=w/'attempts.jsonl';attempts=[json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []
outputs={str(p.relative_to(Path('/opt/data/cron'))):p.read_text() for p in Path('/opt/data/cron/output').rglob('*') if p.is_file() and jid in str(p.relative_to(Path('/opt/data/cron/output'))) and p.suffix in ['.md','.txt','.json']}
print(json.dumps({'observedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'qa':qa,'job':j,'attempts':attempts,'savedOutputs':outputs,'nativeHistory':run(['runs',jid,'--limit','20'])}))
