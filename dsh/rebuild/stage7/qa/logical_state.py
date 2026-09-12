"""Logical preservation fingerprints without emitting data, tokens or message text."""
import argparse,hashlib,json,os,shutil,socket,sqlite3,tempfile
from pathlib import Path
SPECS={
 'native-state':('alica','state.db',['sessions','messages','system_prompts','session_model_usage','async_delegations','delivery_obligations']),
 'native-kanban':('alica','kanban.db',['tasks','task_links','task_comments','task_events','task_runs','task_attachments']),
 'native-projects':('alica','projects.db',['projects','project_folders','project_meta']),
 'native-response-store':('alica','response_store.db',['responses','conversations']),
 'native-cron-executions':('alica','cron/executions.db',['executions']),
 'memory-v4':('memory','memoryv4.sqlite3',['schema_migrations','records','idempotency_requests','entities','relations','artifacts','review_findings']),
 'reference-application':('reference','reference.sqlite3',['identity','accounts','requests','effects','deliveries','recurring_grants','recurring_events'])}
def encode(value):return json.dumps(value,sort_keys=True,separators=(',',':'),default=lambda b:{'bytesHex':b.hex()})
def digest(value):return hashlib.sha256(encode(value).encode()).hexdigest()
def snapshot(archive_root=None):
 if archive_root:
  b=Path(archive_root);roots={'alica':b/'volume-dsh2-stage7-qa3_alica-data','memory':b/'volume-dsh2-stage7-qa3_memory-data','reference':b/'qa-dsh2-stage7-qa3/reference-data'}
 else:
  assert os.geteuid()==0 and socket.gethostname()=='DSH2';roots={'alica':Path('/var/lib/docker/volumes/dsh2-stage7-qa3_alica-data/_data'),'memory':Path('/var/lib/docker/volumes/dsh2-stage7-qa3_memory-data/_data'),'reference':Path('/var/lib/alica-stage7-qa3/reference-data')}
 result={'schema':'stage7-logical-preservation/v1','databases':{}}
 for name,(root,file,tables) in SPECS.items():
  path=roots[root]/file;assert path.is_file()
  with tempfile.TemporaryDirectory() as td:
   if archive_root:
    # Never create SHM/locks in the independently verified off-host extraction.
    copy=Path(td)/path.name;shutil.copy2(path,copy)
    for suffix in ('-wal','-shm'):
     if Path(str(path)+suffix).exists():shutil.copy2(Path(str(path)+suffix),Path(str(copy)+suffix))
    source=sqlite3.connect('file:'+str(copy)+'?mode=ro',uri=True)
   else:source=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True)
   db=sqlite3.connect(':memory:');source.backup(db);source.close()
   assert db.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
   schema=db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").fetchall()
   entry={'schemaSha256':digest(schema),'integrity':'ok','tables':{}}
   for table in tables:
    rows=db.execute('SELECT * FROM "'+table+'"').fetchall();values=sorted(encode(row) for row in rows)
    entry['tables'][table]={'rows':len(rows),'sha256':digest(values)}
   result['databases'][name]=entry;db.close()
 return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--archive-root');a=p.parse_args();print(json.dumps(snapshot(a.archive_root)))
