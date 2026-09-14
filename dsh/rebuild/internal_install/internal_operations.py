"""Explicit, bounded compatibility patch for the authenticated QA operations archive.
Accept the installer's dedicated-cell namespace without removing runtime identity,
owner-file, label, image, mount, root-ownership, or command allowlist checks.
"""
import io,tarfile
from pathlib import Path
OLD="r'dsh2-stage[0-9]+-qa[0-9]+'"
NEW="r'dsh2-[a-z0-9-]{3,40}'"
def adapt(source,target):
    with tarfile.open(source) as inp,tarfile.open(target,'w') as out:
        patched=[]
        for member in inp.getmembers():
            if not member.isfile() or Path(member.name).parent.as_posix()!='doghouse_dsh':raise ValueError('Unexpected operations archive member')
            data=inp.extractfile(member).read()
            if member.name in ['doghouse_dsh/broker.py','doghouse_dsh/native_observation.py']:
                text=data.decode();assert text.count(OLD)==1,'Unexpected namespace contract'
                text=text.replace(OLD,NEW)
                if member.name.endswith('/broker.py'):
                    old="        if set(self.c['images'])!=set(SERVICES):"
                    assert text.count(old)==1
                    text=text.replace(old,"        if self.root.name!=self.cell:raise Rejected('root-cell-mismatch')\n"+old)
                data=text.encode();patched.append(member.name)
            member.size=len(data);out.addfile(member,io.BytesIO(data))
        assert len(patched)==2
