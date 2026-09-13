"""Build separately tagged, flattened Linux images; never start original QA.
Approved removals: build caches, Windows binaries, optional Photon integration.
Export-only containers never execute. Retained hardlinks become regular files.
No compliance or runtime acceptance is inferred from successful assembly.
"""
import argparse,copy,hashlib,io,json,os,posixpath,socket,subprocess,tarfile
from pathlib import Path
RELEASE='1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c'
ROOT=Path('/srv/alica-stage7-72297c3/bundle')
CACHE=('root/.cache/uv','root/.cache/pip','root/.npm','root/.cargo/registry','root/.cargo/git','var/cache/apt/archives')
PHOTON='opt/hermes/plugins/platforms/photon'

def norm(p):
    if p.startswith('/') or '..' in p.split('/') or '\\' in p:raise ValueError('Unsafe member path: '+p)
    return posixpath.normpath(p).removeprefix('./')
def removed(p):
    if any(p==q or p.startswith(q+'/') for q in CACHE):return 'approved-build-cache'
    if p==PHOTON or p.startswith(PHOTON+'/'):return 'approved-optional-photon'
    if p.lower().endswith(('.exe','.dll','.pyd')):return 'approved-windows-binary'
    return None
def digest(f):
    h=hashlib.sha256()
    for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def sha(p):
    with Path(p).open('rb') as f:return digest(f)
def js(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def cmd(args,**kwargs):return subprocess.check_output(args,text=True,timeout=kwargs.pop('timeout',120),**kwargs)

def clean_tar(source,dest):
    retained=[];deleted=[];converted=[]
    if Path(dest).exists():raise ValueError('Refuse layer replacement')
    with tarfile.open(source) as t,tarfile.open(dest,'w',format=tarfile.PAX_FORMAT) as out:
        members=t.getmembers();names=[norm(m.name) for m in members]
        if len(names)!=len(set(names)):raise ValueError('Ambiguous source archive')
        byname=dict(zip(names,members))
        for name in sorted(byname):
            old=byname[name];why=removed(name)
            if '/.wh.' in '/'+name:raise ValueError('Export still contains layer whiteouts')
            if why:
                deleted.append({'path':name,'reason':why,'bytes':old.size});continue
            m=copy.copy(old);m.name=name
            if m.issym():
                target=posixpath.normpath(m.linkname.lstrip('/') if m.linkname.startswith('/') else posixpath.join(posixpath.dirname(name),m.linkname))
                if removed(target):raise ValueError('Retained symlink points into removed payload: '+name)
            if m.islnk():
                converted.append({'path':name,'oldTarget':m.linkname})
                # TarFile resolves authenticated export hardlinks; no host extraction.
                f=t.extractfile(old)
                if f is None:raise ValueError('Missing retained hardlink target')
                f.seek(0,2);m.size=f.tell();f.seek(0);m.type=tarfile.REGTYPE;m.linkname=''
                m.pax_headers={k:v for k,v in m.pax_headers.items() if k not in ('linkpath','size')}
            elif m.isfile():f=t.extractfile(old)
            else:f=None
            record={'path':name,'type':m.type.decode(),'mode':m.mode,'uid':m.uid,'gid':m.gid,'bytes':m.size,'link':m.linkname}
            if f is not None:
                record['sha256']=digest(f);f.seek(0)
            retained.append(record);out.addfile(m,f)
    # Independent replay of output content, permissions and absence policy.
    with tarfile.open(dest) as t:
        actual=[]
        for m in t:
            name=norm(m.name)
            if removed(name) or m.islnk():raise ValueError('Removed payload or unresolved hardlink retained')
            r={'path':name,'type':m.type.decode(),'mode':m.mode,'uid':m.uid,'gid':m.gid,'bytes':m.size,'link':m.linkname}
            if m.isfile():r['sha256']=digest(t.extractfile(m))
            actual.append(r)
        if actual!=retained:raise ValueError('Retained bytes/permissions changed')
    return {'removed':deleted,'retained':retained,'materializedHardlinks':converted,'sourceExportSha256':sha(source),'cleanLayerSha256':sha(dest),'retainedBytesVerified':True}

def canonical_snapshot(rows):
    rows=copy.deepcopy(rows)
    for row in rows:row['Mounts']=sorted(row.get('Mounts',[]),key=lambda m:m['Destination'])
    return sorted(rows,key=lambda row:row['Id'])
def container_snapshot():
    ids=cmd(['docker','ps','-aq']).split()
    return canonical_snapshot(json.loads(cmd(['docker','inspect',*ids])) if ids else [])
def add_bytes(t,n,b):
    m=tarfile.TarInfo(n);m.size=len(b);m.mode=0o644;t.addfile(m,io.BytesIO(b))
def image_archive(config,layer,path,tag):
    c=copy.deepcopy(config);h=sha(layer);c['rootfs']={'type':'layers','diff_ids':['sha256:'+h]}
    c['history']=[{'created':c.get('created'),'created_by':'stage74 approved payload cleanup; original evidence preserved'}]
    b=(json.dumps(c,sort_keys=True,separators=(',',':'))+'\n').encode();ident=hashlib.sha256(b).hexdigest()
    with tarfile.open(path,'w') as t:
        add_bytes(t,ident+'.json',b)
        add_bytes(t,'manifest.json',json.dumps([{'Config':ident+'.json','RepoTags':[tag],'Layers':[h+'/layer.tar']}]).encode())
        m=tarfile.TarInfo(h+'/layer.tar');m.size=Path(layer).stat().st_size;m.mode=0o644
        with Path(layer).open('rb') as f:t.addfile(m,f)
    return 'sha256:'+ident

def build(output):
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong build host/user')
    output=Path(output)
    if output.parent!=Path('/srv') or not output.name.startswith('alica-stage74-clean-'):raise ValueError('Unsafe new candidate directory')
    if output.exists():raise ValueError('Refuse candidate replacement')
    if sha(ROOT/'release.json')!=RELEASE:raise ValueError('Original release mismatch')
    release=json.loads((ROOT/'release.json').read_bytes())
    for n,h in release['files'].items():
        if Path(n).name!=n or (ROOT/n).is_symlink() or sha(ROOT/n)!=h:raise ValueError('Changed original member: '+n)
    before=container_snapshot()
    if len(before)!=8 or any(c['State']['Running'] for c in before):raise ValueError('Original QA not exclusively stopped')
    configs={}
    for n in ['images.tar','reference-image.tar']:
        with tarfile.open(ROOT/n) as t:
            for im in json.load(t.extractfile('manifest.json')):
                b=t.extractfile(im['Config']).read();configs['sha256:'+hashlib.sha256(b).hexdigest()]=json.loads(b)
    roles={k:v['id'] for k,v in release['images'].items()}
    refs=set(configs)-set(roles.values())
    if len(refs)!=1:raise ValueError('Ambiguous reference image')
    roles['reference-application']=refs.pop()
    output.mkdir(mode=0o700);js(output/'original-containers.private.json',before)
    report={'schema':'stage74-clean-candidate/v1','originalReleaseSha256':RELEASE,'approvedRemovals':['build caches','Windows binaries','optional Photon integrations'],'images':{},'runtimeAccepted':False,'engineeringComplete':False,'stage74Accepted':False}
    js(output/'build-receipt.json',report)
    for role,old in sorted(roles.items()):
        config=configs[old]
        if config.get('os')!='linux' or config.get('architecture')!='amd64':raise ValueError('Unsupported image platform')
        folder=output/role;folder.mkdir();name='stage74-clean-export-'+role;tag='alica-stage74-clean:'+role
        for target in [name]:
            if subprocess.run(['docker','container','inspect',target],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:raise ValueError('Export container name collision')
        if subprocess.run(['docker','image','inspect',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:raise ValueError('Clean image tag collision')
        cid=cmd(['docker','create','--name',name,'--network','none','--entrypoint','/__stage74_never_execute__',old]).strip()
        try:
            cmd(['docker','export','--output',str(folder/'original-export.tar'),cid],timeout=900)
            state=json.loads(cmd(['docker','inspect',cid]))[0]['State']
            if state['Running'] or not state['StartedAt'].startswith('0001-'):raise ValueError('Export container was executed')
        finally:
            cmd(['docker','rm','-v',cid])
        evidence=clean_tar(folder/'original-export.tar',folder/'clean-layer.tar');js(folder/'transformation.json',evidence)
        image=image_archive(config,folder/'clean-layer.tar',folder/'image.tar',tag)
        cmd(['docker','load','--input',str(folder/'image.tar')],timeout=900)
        inspection=json.loads(cmd(['docker','image','inspect',tag]))[0]
        if inspection['Id']!=image or inspection['Config']!=json.loads(cmd(['docker','image','inspect',old]))[0]['Config']:raise ValueError('Image ID or runtime configuration changed unexpectedly')
        if inspection['RootFS']['Layers']!=['sha256:'+evidence['cleanLayerSha256']]:raise ValueError('Old layers still present')
        report['images'][role]={'originalImageId':old,'imageId':image,'tag':tag,'archiveSha256':sha(folder/'image.tar'),'transformationSha256':sha(folder/'transformation.json'),'removedEntries':len(evidence['removed']),'materializedHardlinks':len(evidence['materializedHardlinks']),'retainedEntries':len(evidence['retained']),'runtimeConfigurationPreserved':True,'singleLayer':True}
        js(output/'build-receipt.json',report);print(json.dumps({'role':role,**report['images'][role]}),flush=True)
    if container_snapshot()!=before:raise ValueError('Original container state changed')
    for n,h in release['files'].items():
        if sha(ROOT/n)!=h:raise ValueError('Original payload changed after build')
    report.update(buildComplete=True,originalContainersUnchanged=True,originalBundleUnchanged=True)
    js(output/'build-receipt.json',report);print(json.dumps({'buildComplete':True,'images':len(roles),'runtimeAccepted':False}),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output');a=p.parse_args();build(a.output)
