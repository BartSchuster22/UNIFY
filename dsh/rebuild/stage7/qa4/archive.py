#!/usr/bin/env python3
"""Cold owner-store archive. age encryption; pinned ciphertext; no live-store copying.

Call under the lifecycle's quiescence/operation locks. This module NEVER stops,
starts, deletes, or overwrites an installation. Extraction is into a NEW directory.
"""
import argparse,gzip,hashlib,io,json,os,posixpath,re,stat,subprocess,tarfile,time
from pathlib import Path,PurePosixPath

SCHEMA='alica-cold-backup/v1'
LIMIT=100*1024**3

def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def name_ok(name):
 p=PurePosixPath(name)
 if not name or p.is_absolute() or '..' in p.parts or '.' in name.split('/') or '\\' in name or str(p)!=name or '\x00' in name:
  raise ValueError('Unsafe archive name')
 return p

def entry(path,name):
 name_ok(name);s=path.lstat();base={'name':name,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'mtime':s.st_mtime}
 if stat.S_ISREG(s.st_mode):return {**base,'type':'file','size':s.st_size,'sha256':digest(path)}
 if stat.S_ISDIR(s.st_mode):return {**base,'type':'directory','size':0}
 if stat.S_ISLNK(s.st_mode):
  target=os.readlink(path)
  if PurePosixPath(target).is_absolute():raise ValueError('Absolute symlink is nonportable')
  resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),target))
  if resolved.split('/')[0]!=name.split('/')[0] or resolved.startswith('../'):raise ValueError('Escaping symlink')
  return {**base,'type':'symlink','size':0,'target':target}
 raise ValueError('Special files are not backup data')

def validate_manifest(m):
 if m.get('schema')!=SCHEMA or not m.get('entries'):raise ValueError('Unsupported manifest')
 rows={}
 for row in m['entries']:
  p=name_ok(row['name'])
  if row['name'] in rows or row['type'] not in ('file','directory','symlink'):raise ValueError('Duplicate or invalid entry')
  allowed_mode=0o1777 if row['type']=='directory' else 0o777
  if row['size']<0 or row['mode']&~allowed_mode or min(row['uid'],row['gid'])<0:raise ValueError('Unsafe metadata')
  if row['type']=='file' and not re.fullmatch('[a-f0-9]{64}',row['sha256']):raise ValueError('Invalid digest')
  rows[row['name']]=row
 if sum(x['size'] for x in rows.values())>LIMIT:raise ValueError('Expansion bound exceeded')
 for name,row in rows.items():
  for parent in PurePosixPath(name).parents:
   if str(parent)!='.' and (str(parent) not in rows or rows[str(parent)]['type']!='directory'):raise ValueError('Missing or non-directory ancestor')
  if row['type']=='symlink':
   target=row['target'];dest=posixpath.normpath(posixpath.join(posixpath.dirname(name),target))
   if PurePosixPath(target).is_absolute() or dest.split('/')[0]!=name.split('/')[0] or dest.startswith('../'):raise ValueError('Escaping symlink')
 return rows

def create(spec_path,recipient,output):
 spec=json.loads(Path(spec_path).read_text());out=Path(output)
 if out.exists() or out.is_symlink() or not out.parent.is_dir():raise ValueError('New backup path required')
 if not re.fullmatch('age1[0-9a-z]{58}',recipient):raise ValueError('X25519 age recipient required')
 if spec.get('quiesced') is not True:raise ValueError('Lifecycle quiescence required')
 files={};rows=[]
 for prefix,source in sorted(spec['sources'].items()):
  if '/' in prefix or prefix=='manifest.json':raise ValueError('Invalid source prefix')
  root=Path(source)
  if not root.is_dir() or root.is_symlink():raise ValueError('Real source directory required')
  for p in [root,*sorted(root.rglob('*'))]:
   n=prefix if p==root else prefix+'/'+p.relative_to(root).as_posix()
   row=entry(p,n);rows.append(row);files[n]=p
 m={'schema':SCHEMA,'createdAt':time.time(),'metadata':spec['metadata'],'entries':rows}
 validate_manifest(m);body=json.dumps(m,sort_keys=True).encode();partial=Path(str(out)+'.partial')
 fd=os.open(partial,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 try:
  with os.fdopen(fd,'wb') as sink:
   proc=subprocess.Popen(['age','--encrypt','-r',recipient],stdin=subprocess.PIPE,stdout=sink,stderr=subprocess.PIPE)
   try:
    with gzip.GzipFile(fileobj=proc.stdin,mode='wb',compresslevel=1,mtime=0) as z, tarfile.open(fileobj=z,mode='w|',format=tarfile.PAX_FORMAT) as archive:
     t=tarfile.TarInfo('manifest.json');t.size=len(body);t.mode=0o600;archive.addfile(t,io.BytesIO(body))
     for row in rows:
      p=files[row['name']]
      current=entry(p,row['name'])
      if current!=row:raise ValueError('Source changed during backup: '+row['name']+' fields='+','.join(k for k in row if current.get(k)!=row[k]))
      archive.add(p,arcname=row['name'],recursive=False)
    proc.stdin.close();assert proc.wait(timeout=120)==0,'Encryption failed'
   except BaseException:
    proc.kill();proc.wait();raise
   finally:
    try:
     if proc.stdin:proc.stdin.close()
    except BrokenPipeError:pass
    if proc.stderr:proc.stderr.close()
   sink.flush();os.fsync(sink.fileno())
  os.link(partial,out);partial.unlink()
 except BaseException:
  partial.unlink(missing_ok=True);raise
 return {'schema':SCHEMA,'ciphertextSha256':digest(out),'encryptedBytes':out.stat().st_size,'entries':len(rows),'plaintextBytes':sum(r['size'] for r in rows),'manifestSha256':hashlib.sha256(body).hexdigest(),'sourceLeftQuiesced':True}

def verify(archive,key,expected,destination=None):
 if not re.fullmatch('[a-f0-9]{64}',expected) or digest(archive)!=expected:raise ValueError('Ciphertext checksum mismatch')
 dest=Path(destination) if destination else None
 if dest:
  if dest.exists() or dest.is_symlink():raise ValueError('Restore destination must not exist')
  dest.mkdir(mode=0o700)
 proc=subprocess.Popen(['age','--decrypt','-i',str(key),str(archive)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 try:
  with tarfile.open(fileobj=proc.stdout,mode='r|gz') as tar:
   first=tar.next()
   if not first or first.name!='manifest.json' or not first.isfile() or first.size>32*1024**2:raise ValueError('Missing bounded manifest')
   raw=tar.extractfile(first).read();m=json.loads(raw);rows=validate_manifest(m);seen=set()
   for member in tar:
    if member is first:continue
    n=member.name;name_ok(n)
    if n not in rows or n in seen:raise ValueError('Unexpected or duplicate member')
    row=rows[n];seen.add(n)
    hardlink=member.islnk()
    typ='file' if member.isfile() or hardlink else 'directory' if member.isdir() else 'symlink' if member.issym() else 'invalid'
    if hardlink:
     ref=member.linkname;name_ok(ref)
     if ref==n or ref not in seen or rows[ref]['type']!='file':raise ValueError('Unverified hardlink target')
     if any(rows[ref][k]!=row[k] for k in ('sha256','size','uid','gid','mode')):raise ValueError('Hardlink content/metadata mismatch')
     if member.size!=0:raise ValueError('Hardlink has unexpected payload')
    actual_size=row['size'] if hardlink else member.size
    if typ!=row['type'] or actual_size!=row['size'] or member.mode!=row['mode'] or member.uid!=row['uid'] or member.gid!=row['gid']:raise ValueError('Member metadata mismatch: '+n)
    target=dest/n if dest else None
    if typ=='directory' and dest:target.mkdir(mode=0o700)
    elif typ=='symlink':
     if member.linkname!=row['target']:raise ValueError('Symlink mismatch')
     if dest:target.symlink_to(member.linkname)
    elif hardlink:
     if dest:os.link(dest/member.linkname,target,follow_symlinks=False)
    elif typ=='file':
     h=hashlib.sha256();source=tar.extractfile(member);sink=target.open('xb') if dest else None
     try:
      for block in iter(lambda:source.read(1024*1024),b''):
       h.update(block)
       if sink:sink.write(block)
     finally:
      if sink:sink.close()
     if h.hexdigest()!=row['sha256']:raise ValueError('Content hash mismatch')
   if seen!=set(rows):raise ValueError('Missing members')
  # Drain to EOF: do not mistake a valid tar prefix for a fully authenticated age stream.
  while proc.stdout.read(1024*1024):pass
  if proc.wait(timeout=120)!=0:raise ValueError('Ciphertext authentication failed')
  if dest:
   for row in reversed(m['entries']):
    p=dest/row['name']
    if os.geteuid()==0:os.chown(p,row['uid'],row['gid'],follow_symlinks=False)
    if row['type']!='symlink':p.chmod(row['mode']);os.utime(p,(row['mtime'],row['mtime']))
   (dest/'manifest.json').write_bytes(raw);(dest/'manifest.json').chmod(0o600)
   (dest/'VERIFIED').write_text(expected+'\n')
  return {'ciphertextSha256':expected,'manifestSha256':hashlib.sha256(raw).hexdigest(),'entriesVerified':len(seen),'authenticationVerified':True,'contentsVerified':True,'extracted':bool(dest)}
 except BaseException:
  proc.kill();proc.wait()
  # Failed staging is deliberately retained without VERIFIED; never activate it.
  raise
 finally:
  if proc.stdout:proc.stdout.close()
  if proc.stderr:proc.stderr.close()

def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='action',required=True)
 c=sub.add_parser('create');c.add_argument('--spec',required=True);c.add_argument('--recipient',required=True);c.add_argument('--output',required=True)
 for verb in ('verify','extract'):
  v=sub.add_parser(verb);v.add_argument('--archive',required=True);v.add_argument('--identity',required=True);v.add_argument('--sha256',required=True)
  if verb=='extract':v.add_argument('--destination',required=True)
 a=p.parse_args()
 if a.action=='create':r=create(a.spec,a.recipient,a.output)
 else:r=verify(a.archive,a.identity,a.sha256,getattr(a,'destination',None))
 print(json.dumps(r))
if __name__=='__main__':main()
