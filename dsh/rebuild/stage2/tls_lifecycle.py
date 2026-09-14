"""Cell-local PKI. Public HTTPS is managed by Caddy, not this private CA.
Renewal writes must run while the owning cell is stopped under lifecycle locks.
Existing bind-mounted inodes are retained; credentials never enter receipts.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

NAMES=('framework-ca.key','framework-ca.crt','alica.key','alica.crt','edge.key','edge.crt')

def run(args):
    p=subprocess.run(['openssl',*map(str,args)],capture_output=True,timeout=60)
    if p.returncode:raise RuntimeError('Private TLS validation/generation failed')
    return p.stdout

def safe(directory):
    directory=Path(directory)
    if directory.is_symlink() or not directory.is_dir():raise RuntimeError('Unsafe PKI directory')
    for name in NAMES:
        p=directory/name
        if p.is_symlink() or p.exists() and (not p.is_file() or p.stat().st_nlink!=1):raise RuntimeError('Unsafe PKI file')
    return directory

def check(directory,hostname):
    d=safe(directory)
    for stem,dns in [('alica','hermes-adapter'),('edge',hostname)]:
        run(['verify','-x509_strict','-purpose','sslserver','-verify_hostname',dns,'-CAfile',d/'framework-ca.crt',d/(stem+'.crt')])
        cert=run(['x509','-in',d/(stem+'.crt'),'-pubkey','-noout'])
        key=run(['pkey','-in',d/(stem+'.key'),'-pubout'])
        if cert!=key:raise RuntimeError('TLS key does not match certificate')
    if run(['x509','-in',d/'framework-ca.crt','-pubkey','-noout'])!=run(['pkey','-in',d/'framework-ca.key','-pubout']):raise RuntimeError('CA key mismatch')

def expires(path,days):
    p=subprocess.run(['openssl','x509','-in',str(path),'-checkend',str(days*86400),'-noout'],capture_output=True,timeout=30)
    if p.returncode not in (0,1):raise RuntimeError('Certificate expiry check failed')
    return p.returncode!=0

def due(directory):
    d=safe(directory)
    return any(expires(d/n,30) for n in ['alica.crt','edge.crt']) or expires(d/'framework-ca.crt',120)

def generate(directory,hostname,ca=None):
    d=Path(directory)
    if ca:
        for name in ['framework-ca.key','framework-ca.crt']:shutil.copyfile(Path(ca)/name,d/name)
    else:
        run(['req','-x509','-newkey','rsa:2048','-nodes','-days','3650','-subj','/CN=ALICA Cell Private CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',d/'framework-ca.key','-out',d/'framework-ca.crt'])
    for stem,dns in [('alica','hermes-adapter'),('edge',hostname)]:
        run(['req','-newkey','rsa:2048','-nodes','-subj','/CN='+dns,'-keyout',d/(stem+'.key'),'-out',d/(stem+'.csr')])
        (d/(stem+'.ext')).write_text('subjectAltName=DNS:'+dns+'\nextendedKeyUsage=serverAuth\n')
        run(['x509','-req','-in',d/(stem+'.csr'),'-CA',d/'framework-ca.crt','-CAkey',d/'framework-ca.key','-CAcreateserial','-days','90','-sha256','-extfile',d/(stem+'.ext'),'-out',d/(stem+'.crt')])
    check(d,hostname)

def contents(directory):
    d=safe(directory)
    return {n:(d/n).read_bytes() for n in NAMES}

def write(directory,data):
    d=safe(directory)
    for name,value in data.items():
        if name not in NAMES:raise RuntimeError('Unknown PKI file')
        mode=0o400 if name=='framework-ca.key' else 0o444
        fd=os.open(d/name,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,mode)
        with os.fdopen(fd,'wb') as f:f.write(value);f.flush();os.fchmod(f.fileno(),mode);os.fsync(f.fileno())

def staged(directory,hostname,initial=False):
    d=safe(directory)
    with tempfile.TemporaryDirectory(prefix='.tls-',dir=d) as temp:
        generate(temp,hostname,None if initial or expires(d/'framework-ca.crt',120) else d)
        return contents(temp)

def ensure(directory,hostname):
    d=safe(directory)
    present=[(d/n).exists() for n in NAMES]
    if not any(present):write(d,staged(d,hostname,initial=True))
    elif not all(present):raise RuntimeError('Incomplete PKI; explicit recovery required')
    check(d,hostname)

def renew(installer,force=False):
    """Caller holds operations lock/maintenance; use the installer transaction lock here.
    Persistent rollback bytes precede stopping. An interrupted renewal stays fenced
    and is recovered explicitly, never silently declared successful at boot.
    """
    d=installer.root/'secrets';host=installer.r['origin'].split('://',1)[1].split(':',1)[0]
    recovery=d/'.tls-renewal-recovery'
    if recovery.exists():raise RuntimeError('Interrupted TLS renewal: recovery required')
    if not force and not due(d):return {'tls':'not-due'}
    fresh=staged(d,host);old=contents(d)
    with installer.tx.locked():
        recovery.mkdir(mode=0o700)
        write(recovery,old)
        try:
            installer.stop();write(d,fresh);check(d,host)
        except BaseException:
            write(d,old)
            raise
    try:
        installer.start()
    except BaseException:
        with installer.tx.locked():installer.stop();write(d,old)
        # Keep maintenance fencing and recovery bytes; never hide a failed restart.
        raise
    shutil.rmtree(recovery)
    return {'tls':'renewed','privateLeafDays':90,'publicTls':'Caddy-managed'}

def recover(installer):
    d=installer.root/'secrets';backup=d/'.tls-renewal-recovery'
    host=installer.r['origin'].split('://',1)[1].split(':',1)[0]
    old=contents(backup);check(backup,host)
    with installer.tx.locked():installer.stop();write(d,old);check(d,host)
    installer.start()
    shutil.rmtree(backup)
    return {'tls':'recovered','restoredPreviousCertificates':True}
