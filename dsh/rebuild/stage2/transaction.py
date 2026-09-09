"""Stage 2 durable transaction journal. No Docker or global filesystem authority.
The deployment driver must supply bounded, owner-checked steps and rollback.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import shutil

class TransactionError(RuntimeError): pass

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def atomic_json(path,value):
    path=Path(path)
    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW
    tmp=path.with_name(path.name+'.new')
    if tmp.exists():
        if tmp.is_symlink() or not tmp.is_file():raise TransactionError('Unsafe journal temporary file')
        tmp.unlink()
    fd=os.open(tmp,flags,0o600)
    try:
        with os.fdopen(fd,'w') as f:
            json.dump(value,f,sort_keys=True,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
        parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(parent)
        finally:os.close(parent)
    finally:
        if tmp.exists():tmp.unlink()

class Transaction:
    def __init__(self,root,request,release):
        self.root=Path(root).absolute()
        if self.root==Path('/') or any(p.is_symlink() for p in [self.root,*self.root.parents]):
            raise TransactionError('Unsafe installation path')
        self.identity={'schema':'dsh-stage2-owner/v1','request':fingerprint(request),'release':fingerprint(release)}
        self.owner=self.root/'owner.json';self.journal=self.root/'transaction.json'

    def inspect(self):
        """Read-only plan/recovery check; never creates a directory or lock."""
        if not self.root.exists():return {'state':'absent','completed':[]}
        if not self.root.is_dir() or stat.S_IMODE(self.root.stat().st_mode)&0o077:
            raise TransactionError('Installation directory must be private')
        if self.owner.is_symlink() or self.journal.is_symlink():raise TransactionError('Unsafe ownership record')
        if not self.owner.is_file():raise TransactionError('Refusing existing unowned installation path')
        if json.loads(self.owner.read_text())!=self.identity:raise TransactionError('Owner/request/release mismatch')
        value=json.loads(self.journal.read_text()) if self.journal.exists() else {'state':'prepared','completed':[]}
        if value.get('state') not in {'prepared','running','rolled-back','rollback-failed','installed','uninstalled-data-retained'}:
            raise TransactionError('Unknown recovery state')
        return value

    @contextmanager
    def locked(self):
        self.inspect()
        # Lock outside the new root so two installers cannot race ownership creation.
        parent=self.root.parent
        if not parent.is_dir():raise TransactionError('Installation parent must already exist')
        lock=parent/('.'+self.root.name+'.install.lock')
        fd=os.open(lock,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        try:
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise TransactionError('Another installation transaction is active')
            self.inspect()
            if not self.root.exists():
                staging=Path(tempfile.mkdtemp(prefix='.'+self.root.name+'.prepare-',dir=parent))
                try:
                    atomic_json(staging/'owner.json',self.identity)
                    atomic_json(staging/'transaction.json',{'state':'prepared','completed':[]})
                    os.rename(staging,self.root)
                    parent_fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY)
                    try:os.fsync(parent_fd)
                    finally:os.close(parent_fd)
                finally:
                    if staging.exists():shutil.rmtree(staging)
            yield
        finally:os.close(fd)

    def execute(self,steps,rollback):
        names=[name for name,_ in steps]
        if len(names)!=len(set(names)) or any(not isinstance(n,str) or not n for n in names):
            raise TransactionError('Invalid transaction steps')
        with self.locked():
            old=self.inspect()
            if old['state']=='installed':return old
            completed=[]
            try:
                # Every driver step is required to be idempotent. Retry deliberately
                # rechecks earlier steps rather than trusting a stale health checkpoint.
                for name,action in steps:
                    atomic_json(self.journal,{'state':'running','step':name,'completed':completed})
                    action();completed.append(name)
                result={'state':'installed','completed':completed}
                atomic_json(self.journal,result);return result
            except BaseException:
                try:rollback()
                except BaseException:
                    atomic_json(self.journal,{'state':'rollback-failed','completed':completed})
                    raise TransactionError('Rollback failed; operator recovery required') from None
                atomic_json(self.journal,{'state':'rolled-back','completed':completed})
                raise TransactionError('Installation failed; candidate stopped and data retained') from None
