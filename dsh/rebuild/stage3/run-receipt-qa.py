#!/usr/bin/env python3
"""Disposable PostgreSQL-only qualification. No host port, no existing data."""
import subprocess, pathlib, json, tempfile, os, time, secrets, shutil
REPO=pathlib.Path(__file__).resolve().parents[3]
NAME='dsh3-receipt-qa'
LABEL='com.alica.stage3.qa=receipts'
def run(args,**kwargs):return subprocess.run(args,check=True,text=True,capture_output=True,**kwargs)
def docker(*args,**kwargs):return run(['sudo','-n','docker',*args],**kwargs)
def snapshot():
 ids=docker('ps','-aq').stdout.split()
 rows=json.loads(docker('inspect',*ids).stdout) if ids else []
 return {r['Id']:{'name':r['Name'],'running':r['State']['Running'],'status':r['State']['Status'],'health':r['State'].get('Health',{}).get('Status')} for r in rows}
assert not subprocess.run(['sudo','-n','docker','inspect',NAME],capture_output=True).returncode==0,'QA name already occupied'
avail=int(next(l.split()[1] for l in pathlib.Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')))*1024
assert avail>900*1024*1024,'Insufficient available memory for bounded fixture'
assert shutil.disk_usage(REPO).free>2*1024**3
before=snapshot();created=False
with tempfile.TemporaryDirectory(prefix='stage3-receipts-',dir='/srv/alica-dsh-development') as tmp:
 root=pathlib.Path(tmp);password=root/'password';password.write_text(secrets.token_urlsafe(32));password.chmod(0o444)
 sock=root/'socket';sock.mkdir();sock.chmod(0o777)
 try:
  docker('run','-d','--name',NAME,'--label',LABEL,'--network','none','--cpus','0.5','--memory','512m','--pids-limit','128','--mount',f'type=bind,src={sock},dst=/qa-socket','--mount',f'type=bind,src={password},dst=/run/qa-password,readonly','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_PASSWORD_FILE=/run/qa-password','-e','POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 --auth-host=scram-sha-256','sha256:5c773214aed7adab0900cd0a05dbc468348f76fe1e4c2ca5b0e222e9531f7811','-c','listen_addresses=','-c','unix_socket_directories=/var/run/postgresql,/qa-socket','-c','shared_buffers=32MB');created=True
  deadline=time.monotonic()+60
  while True:
   result=subprocess.run(['sudo','-n','docker','exec',NAME,'pg_isready','-h','/qa-socket','-U','postgres'],capture_output=True)
   logs=docker('logs',NAME);initialized='PostgreSQL init process complete' in logs.stdout+logs.stderr
   if result.returncode==0 and initialized:break
   if time.monotonic()>deadline or not json.loads(docker('inspect',NAME).stdout)[0]['State']['Running']:raise RuntimeError('QA PostgreSQL did not become ready: '+(logs.stdout+logs.stderr)[-4000:])
   time.sleep(.5)
  env=os.environ.copy();env.update(QA_SOCKET=str(sock),QA_PASSWORD_FILE=str(password))
  result=subprocess.run(['node',str(REPO/'dsh/rebuild/stage3/test-receipts.mjs')],env=env,timeout=60,text=True,capture_output=True);print(result.stdout);print(result.stderr);result.check_returncode()
 finally:
  if created:
   row=json.loads(docker('inspect',NAME).stdout)[0];assert row['Config']['Labels'].get('com.alica.stage3.qa')=='receipts'
   docker('stop','--time','10',NAME);docker('rm',NAME)
  assert before==snapshot(),'Existing workloads changed during QA'
  print(json.dumps({'existing_workloads_unchanged':True,'qa_removed':True,'published_ports':False}))
