#!/usr/bin/env python3
"""Host operations enrollment and lifecycle wrapper around the pinned Stage 2 driver."""
import argparse,hashlib,json,os,pwd,shutil,subprocess,sys,tarfile
from pathlib import Path

def run(args):
    r=subprocess.run(args,capture_output=True,text=True,timeout=1000)
    if r.returncode:raise RuntimeError('bounded command failed: '+args[0])
    return r.stdout

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['install','start','stop','uninstall','boot','enroll','maintenance-on','maintenance-off','ack','status']);p.add_argument('--bundle',required=True);p.add_argument('--release-sha256',required=True);p.add_argument('--root',required=True);p.add_argument('--request',required=True);p.add_argument('--service',choices=['hermes','unify-core','memory-v4']);a=p.parse_args()
    if os.geteuid()!=0:raise RuntimeError('root operator required')
    bundle=Path(a.bundle).resolve();sys.path.insert(0,str(bundle))
    from install import Installer
    i=Installer(bundle,a.release_sha256,a.root,json.loads(Path(a.request).read_text()))
    i.operator();root=i.root;cell=i.r['cell'];op=root/'operations';code=Path('/usr/local/lib/alica-dsh-ops')/cell
    config=op/'broker.json'
    if a.action=='install' and not config.exists():
        i.install()
        enroll(a,i,code,op)
        return
    if a.action=='enroll':
        if i.tx.inspect()['state']!='installed':raise RuntimeError('completed installation required')
        enroll(a,i,code,op);return
    sys.path.insert(0,str(code))
    from doghouse_dsh.engine import Engine
    from doghouse_dsh.broker import lock
    from doghouse_dsh.observer import request
    c=json.loads(config.read_text())
    if a.action in ('status','maintenance-on','maintenance-off','ack'):
        body={'op':'snapshot'}
        if a.action.startswith('maintenance-'):body={'op':'maintenance','enabled':a.action=='maintenance-on'}
        if a.action=='ack':body={'op':'ack','service':a.service}
        result=request(c['socket'],body)
        print(json.dumps(result));return
    with lock(op/'operation.lock'):
        e=Engine(op/'ops.db')
        if a.action=='boot' and e.meta('maintenance',False):
            print(json.dumps({'state':'maintenance-retained','started':False}));return
        e.maintenance(True)
        if a.action in ('install','start','boot'):
            result=i.start();e.maintenance(False)
        elif a.action=='stop':
            with i.tx.locked():i.stop()
            result={'state':'stopped','data_retained':True,'maintenance':True}
        else:result=i.uninstall()
        e.db.close();print(json.dumps(result))

def enroll(a,i,code,op):
    if (op/'broker.json').exists():raise RuntimeError('operations already enrolled; use lifecycle wrapper')
    from transaction import atomic_json
    root=i.root;cell=i.r['cell']
    rows=[r for r in i.owned() if r['Config']['Labels'].get('com.docker.compose.service') in i.release['images']]
    if len(rows)!=7 or any(not r['State']['Running'] or r['State'].get('Health',{}).get('Status')!='healthy' for r in rows):raise RuntimeError('joint health required for enrollment')
    try:user=pwd.getpwnam('alica-ops')
    except KeyError:
        run(['/usr/sbin/useradd','--system','--no-create-home','--shell','/usr/sbin/nologin','alica-ops']);user=pwd.getpwnam('alica-ops')
    code.mkdir(parents=True,mode=0o755)
    with tarfile.open(Path(a.bundle)/'doghouse-dsh.tar') as t:
        for member in t.getmembers():
            if not member.name.startswith('doghouse_dsh/') or '..' in Path(member.name).parts or member.issym() or member.islnk():raise RuntimeError('unsafe operations archive')
        t.extractall(code,filter='data')
    for path in code.rglob('*'):os.chown(path,0,0);path.chmod(0o755 if path.is_dir() else 0o644)
    op.mkdir(exist_ok=True,mode=0o700);(op/'public').mkdir(exist_ok=True,mode=0o755)
    sys.path.insert(0,str(code))
    from doghouse_dsh.engine import Engine
    from doghouse_dsh.broker import signature
    e=Engine(op/'ops.db');e.maintenance(False);e.db.close()
    by={r['Config']['Labels']['com.docker.compose.service']:r for r in rows}
    cfg={'root':str(root),'cell':cell,'observerUid':user.pw_uid,'observerGid':user.pw_gid,
         'socket':'/run/alica-ops-'+cell+'/broker.sock','ownerSha256':hashlib.sha256((root/'owner.json').read_bytes()).hexdigest(),
         'images':{s:r['Image'] for s,r in by.items()},
         'signatures':{s:signature(r) for s,r in by.items()},
         'mounts':{s:[list(x) for x in sorted((m['Type'],m['Source'],m['Destination'],m['RW']) for m in r['Mounts'])] for s,r in by.items()},
         'storagePath':str(op),'minimumFreeBytes':1024**3}
    atomic_json(op/'broker.json',cfg)
    # Root-owned immutable wrapper inputs; no secrets are included in argv.
    atomic_json(op/'request.json',i.r)
    args=' '.join(['--bundle',str(Path(a.bundle).resolve()),'--release-sha256',a.release_sha256,'--root',str(root),'--request',str(op/'request.json')])
    if any(c in args for c in ['\n','\r','%',';','"',"'"]):raise RuntimeError('unsafe unit arguments')
    def unit(name,content):
        path=Path('/etc/systemd/system')/name
        if path.exists():raise RuntimeError('unit already exists')
        path.write_text(content);path.chmod(0o644)
    base='alica-'+cell
    unit(base+'-cell.service',f'''[Unit]
Description=ALICA pinned cell lifecycle {cell}
After=docker.service
Requires=docker.service
PartOf=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/python3 {Path(a.bundle).resolve()}/ops.py boot {args}
TimeoutStartSec=1000
[Install]
WantedBy=multi-user.target
''')
    unit(base+'-broker.service',f'''[Unit]
Description=Doghouse DSH bounded root broker {cell}
StartLimitIntervalSec=300
StartLimitBurst=3
After={base}-cell.service
[Service]
User=root
Group=alica-ops
Environment=PYTHONPATH={code}
ExecStart=/usr/bin/python3 -m doghouse_dsh.broker --config {op}/broker.json
Restart=on-failure
RestartSec=30
RuntimeDirectory=alica-ops-{cell}
RuntimeDirectoryMode=0750
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths={op} /run/alica-ops-{cell} {root.parent}/.{root.name}.install.lock
RestrictAddressFamilies=AF_UNIX
MemoryMax=128M
TasksMax=32
[Install]
WantedBy=multi-user.target
''')
    unit(base+'-observer.service',f'''[Unit]
Description=Doghouse DSH unprivileged observer {cell}
StartLimitIntervalSec=300
StartLimitBurst=3
After={base}-broker.service
Wants={base}-broker.service
[Service]
User=alica-ops
Group=alica-ops
Environment=PYTHONPATH={code}
ExecStart=/usr/bin/python3 -m doghouse_dsh.observer --socket {cfg['socket']}
Restart=on-failure
RestartSec=30
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
RestrictAddressFamilies=AF_UNIX
MemoryMax=64M
TasksMax=16
[Install]
WantedBy=multi-user.target
''')
    run(['/usr/bin/systemctl','daemon-reload'])
    run(['/usr/bin/systemctl','enable',base+'-cell.service',base+'-broker.service',base+'-observer.service'])
    run(['/usr/bin/systemctl','start',base+'-broker.service',base+'-observer.service'])
    print(json.dumps({'operations':'enrolled','owner':'doghouse-dsh','cell':cell,'rebootAcceptance':'not yet verified'}))

if __name__=='__main__':main()
