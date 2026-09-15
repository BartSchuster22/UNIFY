#!/usr/bin/env python3
"""Cold-checkpoint DSH2, encrypt off-host, and verify every archived tree.
Leaves the installation fenced for apply. A systemd deadline retries recovery
if the controlling session disappears. Never prints backup contents or keys.
"""
import hashlib,importlib.util,json,os,shlex,stat,subprocess,tarfile,time,uuid
from pathlib import Path,PurePosixPath
spec=importlib.util.spec_from_file_location('prepare',Path(__file__).with_name('prepare-dsh-maintenance.py'));P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P)
DEST=P.DEST;CONTROL='/var/lib/alica/dsh2-internal-maintenance1/control3'
CLI=DEST+'/bundle/maintenance.py';UNIT='alica-dsh2-maintenance3-deadline'
HOME=Path('/home/herman/.config/dsh-maintenance-recovery')
def digest_stream(f):
 h=hashlib.sha256()
 for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def verify_archive(stream,expected):
 trees={};rows={};links=[]
 with tarfile.open(fileobj=stream,mode='r|') as t:
  for m in t:
   parts=PurePosixPath(m.name).parts
   P.require(parts and parts[0]=='checkpoint' and '..' not in parts,'Unsafe checkpoint archive path')
   if len(parts)==1:continue
   category=parts[1];relative='/'.join(parts[2:]) or '.'
   P.require(category in expected and (category,relative) not in rows,'Unexpected/duplicate checkpoint member')
   mode=m.mode|(stat.S_IFDIR if m.isdir() else stat.S_IFLNK if m.issym() else stat.S_IFREG)
   row=[mode,m.uid,m.gid]
   if m.isfile():row+=['file',digest_stream(t.extractfile(m))]
   elif m.issym():row+=['link',m.linkname]
   elif m.islnk():links.append(((category,relative),m.linkname))
   else:P.require(m.isdir(),'Unsupported checkpoint archive member')
   rows[(category,relative)]=row
 for key,target in links:
  parts=PurePosixPath(target).parts;P.require(parts[0]=='checkpoint' and '..' not in parts,'Unsafe hardlink')
  reference=(parts[1],'/'.join(parts[2:]) or '.');P.require(reference in rows and len(rows[reference])==5,'Unresolved hardlink');rows[key]+=rows[reference][3:]
 for (category,relative),row in rows.items():trees.setdefault(category,{})[relative]=row
 actual={k:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest() for k,v in trees.items()}
 P.require(actual==expected,'Decrypted checkpoint trees differ from live cold snapshot');return actual

def main():
 os.umask(0o077);HOME.mkdir(mode=0o700,parents=True,exist_ok=True)
 P.require(not HOME.is_symlink() and HOME.stat().st_uid==os.getuid() and stat.S_IMODE(HOME.stat().st_mode)==0o700,'Unsafe recovery directory')
 key=HOME/'identity.agekey'
 if not key.exists():subprocess.run(['age-keygen','-o',str(key)],check=True,capture_output=True)
 P.require(not key.is_symlink() and key.stat().st_uid==os.getuid() and not key.stat().st_mode&0o077,'Unsafe recovery identity')
 recipient=subprocess.check_output(['age-keygen','-y',str(key)],text=True).strip()
 target=HOME/('checkpoint-'+uuid.uuid4().hex+'.tar.age')
 timer=f"import subprocess;subprocess.run(['systemd-run','--unit',{UNIT!r},'--on-active=10m','--property=Restart=on-failure','--property=RestartSec=15s','--property=StartLimitIntervalSec=0','/usr/bin/python3','-B',{CLI!r},'recover','--candidate',{DEST!r}],check=True)"
 P.remote('dsh',timer)
 try:
  print(P.remote('dsh',f"import subprocess;subprocess.run(['python3','-B',{CLI!r},'backup','--candidate',{DEST!r}],check=True)",timeout=600),flush=True)
  journal=json.loads(P.remote('dsh',f"from pathlib import Path;print((Path({CONTROL!r})/'journal.json').read_text())"))
  producer=subprocess.Popen(P.ssh('dsh')+['sudo -n tar --xattrs --acls --numeric-owner -C '+CONTROL+' -cf - checkpoint'],stdout=subprocess.PIPE)
  encrypt=subprocess.run(['age','-r',recipient,'-o',str(target)],stdin=producer.stdout,capture_output=True,timeout=180)
  producer.stdout.close();P.require(producer.wait(timeout=30)==0 and encrypt.returncode==0,'Encrypted backup transfer failed')
  decrypt=subprocess.Popen(['age','-d','-i',str(key),str(target)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:
   verified=verify_archive(decrypt.stdout,journal['coldHashes'])
   # Drain authenticated trailing archive padding through age to its EOF.
   while decrypt.stdout.read(1024**2):pass
   P.require(decrypt.wait(timeout=30)==0,'Backup decryption/authentication failed')
  finally:
   if decrypt.poll() is None:decrypt.kill();decrypt.wait()
  with target.open('rb') as f:encrypted_sha=digest_stream(f)
  receipt={'schema':'dsh-maintenance-backup/v1','checkpointHashes':verified,'decryptionVerified':True,'archiveTreeReadbackVerified':True,'encryptedArchive':str(target),'encryptedSha256':encrypted_sha,'bytes':target.stat().st_size,'verifiedAt':time.time(),'fullRuntimeRestoreDrill':False}
  (HOME/'backup-receipt.json').write_text(json.dumps(receipt,indent=2))
  P.remote('dsh',f"from pathlib import Path;import sys,json;p=Path({CONTROL!r})/'offhost-backup-verified.json';assert not p.exists();p.write_text(json.dumps(json.load(sys.stdin),indent=2));p.chmod(0o600)",json.dumps(receipt))
  print(json.dumps({'encryptedBackup':str(target),'bytes':receipt['bytes'],'verifiedColdTrees':len(verified),'servicesFenced':True,'recoveryDeadlineUnit':UNIT}),flush=True)
 except BaseException:
  try:print(P.remote('dsh',f"import subprocess;subprocess.run(['python3','-B',{CLI!r},'recover','--candidate',{DEST!r}],check=True)",timeout=600),flush=True)
  finally:raise
if __name__=='__main__':main()
