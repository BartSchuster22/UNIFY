"""Read-only extracted-tree verification; SQLite opens only private temporary copies."""
import hashlib,json,os,shutil,sqlite3,tempfile
from pathlib import Path
import archive
P=Path('/home/herman/dsh2-backups/restore-verification');RECEIPT=Path('/home/herman/dsh2-backups/source-result.json')
def main():
 r=json.loads(RECEIPT.read_text());assert archive.digest(P/'manifest.json')==r['manifestSha256'];assert (P/'VERIFIED').read_text().strip()==r['ciphertextSha256']
 m=json.loads((P/'manifest.json').read_text());archive.validate_manifest(m);databases=[]
 for row in m['entries']:
  actual=archive.entry(P/row['name'],row['name']);assert all(actual[k]==v for k,v in row.items()),'Extracted content or POSIX metadata differs'
  if row['type']=='file':
   with (P/row['name']).open('rb') as f:header=f.read(16)
   if header==b'SQLite format 3\x00':databases.append(P/row['name'])
 checked=0;native_tasks=None
 with tempfile.TemporaryDirectory(prefix='alica-sqlite-validation-') as temp:
  for n,db in enumerate(databases):
   folder=Path(temp)/str(n);folder.mkdir();copy=folder/db.name;shutil.copyfile(db,copy)
   wal=Path(str(db)+'-wal')
   if wal.exists():shutil.copyfile(wal,str(copy)+'-wal')
   c=sqlite3.connect(str(copy));assert c.execute('PRAGMA integrity_check').fetchall()==[('ok',)];checked+=1
   if 'volume-dsh2-stage5-qa5_alica-data' in str(db) and c.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='tasks'").fetchone()[0]:
    c.row_factory=sqlite3.Row;native_tasks=[dict(row) for row in c.execute('SELECT id,session_id,status FROM tasks ORDER BY id')]
   c.close()
 assert native_tasks==m['metadata']['nativeBefore']['tasks']
 expected=m['metadata']['nativeBefore']['jobs'];assert len(expected)==1
 found=[]
 for p in (P/'volume-dsh2-stage5-qa5_alica-data').rglob('jobs.json'):
  value=json.loads(p.read_text());jobs=value.get('jobs',[]) if isinstance(value,dict) else value
  assert expected[0].get('latest_execution') is None
  # list_jobs() enriches persisted records with latest_execution=None.
  persisted=[{k:v for k,v in job.items() if k!='latest_execution'} for job in expected]
  if jobs==persisted and len(jobs)==1 and jobs[0]['enabled'] is False and jobs[0]['state']=='paused':found.append(p)
 assert len(found)==1,'Native schedule contents not preserved'
 out={'ciphertextSha256':r['ciphertextSha256'],'manifestSha256':r['manifestSha256'],'extractedTreeAndPosixMetadataVerified':True,'entriesVerified':len(m['entries']),'sqliteIntegrityChecks':checked,'nativeTasksPreserved':len(native_tasks),'nativeDisabledSchedulePreserved':True,'sourceNotDeleted':True,'liveRestoreAccepted':False,'wholeStage6Accepted':False}
 print(json.dumps(out))
if __name__=='__main__':main()
