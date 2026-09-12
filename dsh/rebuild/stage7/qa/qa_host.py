"""Fail closed outside the disposable guest or explicitly enrolled dedicated QA host."""
import json,os,socket,stat
from pathlib import Path

def assert_qa_host(require_root=True):
    if require_root and os.geteuid()!=0:
        raise RuntimeError('QA root operator required')
    host=socket.gethostname()
    if host!='DSH2':
        raise RuntimeError('Host is not approved for Stage 7 faults')
    marker=Path('/etc/alica-stage7-qa.json')
    s=marker.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:
        raise RuntimeError('Unsafe dedicated QA marker')
    expected={'purpose':'alica-stage7-dedicated-qa','hostname':host,'machineId':Path('/etc/machine-id').read_text().strip()}
    if json.loads(marker.read_text())!=expected:
        raise RuntimeError('Dedicated QA identity mismatch')
