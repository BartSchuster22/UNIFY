#!/usr/bin/env python3
"""Exercise candidate migrations on a private, network-isolated cold PG clone."""
import json,shutil,subprocess,time
from pathlib import Path
BASE=Path('/var/lib/alica/dsh2-maintenance-migration-qa4')
CANDIDATE=Path('/var/lib/alica/dsh2-internal-maintenance1/candidate3/bundle')
SOURCE=Path('/var/lib/alica/dsh2-internal-maintenance1/control/checkpoint/postgresql-data')
NAME='qa-dsh2-maintenance-migration1'
def run(*args,**kwargs):return subprocess.run(args,capture_output=True,text=True,check=True,**kwargs).stdout

def main():
 assert not BASE.exists() and SOURCE.is_dir();BASE.mkdir(mode=0o700);(BASE/'socket').mkdir();(BASE/'socket').chmod(0o1777)
 run('cp','-a',str(SOURCE),str(BASE/'data'))
 r=json.loads((CANDIDATE/'release.json').read_text());pg=r['images']['postgresql']['id'];core=r['images']['unify-core']['id']
 live=json.loads(run('docker','inspect','dsh2-internal-onboarding1-postgresql-1'))[0]
 target=next(m['Destination'] for m in live['Mounts'] if m['Type']=='volume')
 env=[]
 for e in live['Config']['Env']:
  if e.startswith(('PGDATA=','POSTGRES_USER=','POSTGRES_DB=')):env+=['-e',e]
 before=run('docker','ps','--format','{{.ID}} {{.Names}} {{.Image}}')
 try:
  run('docker','run','-d','--rm','--name',NAME,'--label','dsh.disposable=maintenance-migration1','--network=none','--mount',f'type=bind,src={BASE}/data,dst={target}','--mount',f'type=bind,src={BASE}/socket,dst=/var/run/postgresql',*env,pg)
  deadline=time.monotonic()+60
  while subprocess.run(['docker','exec',NAME,'psql','-X','-qAt','-U','unify_bootstrap','-d','unify','-c','SELECT 1'],capture_output=True).returncode:
   assert time.monotonic()<deadline,'Isolated PostgreSQL readiness deadline';time.sleep(.25)
  def sql(q):return run('docker','exec',NAME,'psql','-X','-qAt','-U','unify_bootstrap','-d','unify','-c',q).strip()
  users=sql("SELECT md5(string_agg(id::text,',' ORDER BY id)) FROM users")
  result=subprocess.run(['docker','run','--rm','--network=none','--mount',f'type=bind,src={BASE}/socket,dst=/var/run/postgresql','-e','DATABASE_URL=postgresql://unify_bootstrap@localhost/unify?host=/var/run/postgresql',core,'scripts/migrate.mjs','up'],capture_output=True,text=True)
  assert result.returncode==0,result.stderr
  assert sql("SELECT count(*) FROM schema_migrations WHERE version='020_user_preferences'")=='1'
  sql('GRANT SELECT,INSERT,UPDATE,DELETE ON user_time_preferences TO unify;')
  assert sql("SELECT has_table_privilege('unify','user_time_preferences','SELECT') AND NOT has_table_privilege('unify_alica_adapter','user_time_preferences','SELECT')")=='t'
  assert users==sql("SELECT md5(string_agg(id::text,',' ORDER BY id)) FROM users")
  print(json.dumps({'migrationOutput':result.stdout.strip(),'newMigrationApplied':True,'corePermissionGranted':True,'adapterPermissionDenied':True,'existingUsersPreserved':True,'liveDatabaseTouched':False,'network':'none'}))
 finally:
  subprocess.run(['docker','stop',NAME],capture_output=True)
  assert run('docker','ps','--format','{{.ID}} {{.Names}} {{.Image}}')==before,'Live container set changed'
if __name__=='__main__':main()
