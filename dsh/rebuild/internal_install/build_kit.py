#!/usr/bin/env python3
"""Build the small bootstrap kit, not a runtime release, on the development host."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import socket
import subprocess
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def build(output):
    if socket.gethostname() != 'ALICA-v1':
        raise ValueError('Build on the designated ALICA-v1 development host')
    source = Path(__file__).resolve().parent
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain', '--', '.'], text=True)
    if dirty:
        raise ValueError('Commit bootstrap sources before building a revision-bound kit')
    output = Path(output)
    output.mkdir(mode=0o750, parents=False, exist_ok=False)
    files = {'setup.py': (source/'setup.py').read_bytes(),
             'onboarding.py': (source/'onboarding.py').read_bytes(),
             'ONBOARDING.md': (source/'ONBOARDING.md').read_bytes(),
             'release_trust.py': (source.parent/'stage6/release_trust.py').read_bytes(),
             'README.md': (source/'README.md').read_bytes()}
    archive = output/'alica-setup-preview.tar.gz'
    with archive.open('xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w|', format=tarfile.USTAR_FORMAT) as tar:
            for name, data in sorted(files.items()):
                info = tarfile.TarInfo(name); info.size = len(data); info.mode = 0o644
                info.uid = info.gid = info.mtime = 0
                tar.addfile(info, io.BytesIO(data))
    receipt = {'schema': 'alica-setup-kit/v1', 'sourceRevision': revision,
               'archive': archive.name, 'archiveSha256': sha(archive.read_bytes()),
               'files': {name: sha(data) for name, data in files.items()},
               'developmentPreview': True, 'containsRuntimeImages': False,
               'internalReleaseAccepted': False, 'distributionApproved': False}
    (output/'build-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    (output/'SHA256SUMS').write_text(receipt['archiveSha256']+'  '+archive.name+'\n')
    # Read back every emitted member and byte; this verifies packaging, not install readiness.
    with tarfile.open(archive) as t:
        names = t.getnames()
        if len(names) != len(files) or set(names) != set(files):
            raise ValueError('Kit inventory mismatch')
        for member in t:
            if not member.isfile() or t.extractfile(member).read() != files[member.name]:
                raise ValueError('Kit byte mismatch')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', required=True)
    build(p.parse_args().output)
