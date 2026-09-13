"""Read-only package payload/ELF context from frozen layer archives. Executes no payload.
DT_NEEDED is observed, not a proof of absence of dlopen/static incorporation.
"""
import hashlib,json,os,posixpath,socket,struct,tarfile
from pathlib import Path
import build_clean_candidate as b
ROOT=Path('/srv/alica-stage74-clean-candidate1')
def sha(data):return hashlib.sha256(data).hexdigest()
def enc(data):return (json.dumps(data,sort_keys=True,indent=2)+'\n').encode()
def elf(f):
    head=f.read(64)
    if head[:4]!=b'\x7fELF':return None
    if head[4] not in (1,2) or head[5] not in (1,2):return {'error':'unsupported-ELF'}
    end='<' if head[5]==1 else '>';wide=head[4]==2
    hdr=struct.unpack(end+('HHIQQQIHHHHHH' if wide else 'HHIIIIIHHHHHH'),head[16:64] if wide else head[16:52]);off,size,count=hdr[4],hdr[8],hdr[9]
    if count>4096:return {'error':'oversized-program-headers'}
    segs=[];dynamic=[];interp=None
    for i in range(count):
        f.seek(off+i*size);raw=f.read(size);p=struct.unpack_from(end+('IIQQQQQQ' if wide else 'IIIIIIII'),raw)
        typ=p[0];offset,addr,length=(p[2],p[3],p[5]) if wide else (p[1],p[2],p[4]);segs.append((typ,offset,addr,length))
        if typ==3:f.seek(offset);interp=f.read(min(length,4096)).rstrip(b'\0').decode(errors='replace')
        if typ==2:
            f.seek(offset);data=f.read(min(length,1048576));step=16 if wide else 8
            for at in range(0,len(data)-step+1,step):
                tag,value=struct.unpack_from(end+('qQ' if wide else 'iI'),data,at)
                if tag==0:break
                dynamic.append((tag,value))
    strings=b'';address=next((v for k,v in dynamic if k==5),None);length=next((v for k,v in dynamic if k==10),0)
    if address is not None:
        for typ,offset,addr,sz in segs:
            if typ==1 and addr<=address<addr+sz:f.seek(offset+address-addr);strings=f.read(min(length,1048576));break
    def text(at):return strings[at:].split(b'\0',1)[0].decode(errors='replace')
    return {'elfType':hdr[0],'interpreter':interp,'needed':sorted(text(v) for k,v in dynamic if k==1),'soname':next((text(v) for k,v in dynamic if k==14),None),'rpath':[text(v) for k,v in dynamic if k in (15,29)],'coverage':'DT_NEEDED only; dlopen and static incorporation not excluded'}
def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong host/privilege')
    lock=json.loads((ROOT/'step3-candidate-lock.json').read_bytes());before=b.canonical_snapshot(json.loads((ROOT/'original-containers.private.json').read_bytes()))
    if b.container_snapshot()!=before:raise ValueError('QA changed')
    rows=[];natives=[];inputrefs={}
    for role,pin in sorted(lock['images'].items()):
        folder=ROOT/role
        if b.sha(folder/'clean-layer.tar')!=pin['layerSha256']:raise ValueError('Layer drift')
        tr=json.loads((folder/'transformation.json').read_bytes());files={x['path']:x for x in tr['retained']};scanpath=ROOT/'scans'/(role+'.syft.private.json');raw=scanpath.read_bytes();scan=json.loads(raw);inputrefs[role]=sha(raw)
        with tarfile.open(folder/'clean-layer.tar') as t:
            members={b.norm(m.name):m for m in t.getmembers()};native={}
            for path,m in members.items():
                if not m.isfile() or m.size<4:continue
                f=t.extractfile(m)
                if f is None:raise ValueError('Missing file')
                magic=f.read(8)
                if magic[:4]==b'\x7fELF':
                    f.seek(0)
                    try:e=elf(f)
                    except (ValueError,struct.error,IndexError) as error:e={'error':type(error).__name__}
                    if e is None:raise ValueError('ELF signature changed')
                    native[path]={'image':role,'path':path,'sha256':files[path]['sha256'],'format':'ELF',**e}
                elif magic==b'!<arch>\n':native[path]={'image':role,'path':path,'sha256':files[path]['sha256'],'format':'static-archive','coverage':'presence is not proof it was linked into an executable'}
            natives.extend(native.values())
            for r in scan['artifacts']:
                typ=r['type'];meta=r.get('metadata',{});locs=r.get('locations',[]);primary=[x['path'].lstrip('/') for x in locs if x.get('annotations',{}).get('evidence')=='primary'];owned=[];method=None
                if typ in ['deb','rpm','apk']:
                    owned=[x['path'].lstrip('/') for x in meta.get('files',[])];method='package-manager-file-inventory'
                    if typ=='deb':
                        for listing in ['var/lib/dpkg/info/'+r['name']+'.list','var/lib/dpkg/info/'+r['name']+':'+meta.get('architecture','')+'.list']:
                            if listing in members:
                                f=t.extractfile(members[listing])
                                if f is None:raise ValueError('Missing dpkg file list')
                                owned.extend(line.lstrip('/') for line in f.read().decode().splitlines());method='package-manager-files-and-dpkg-list'
                elif typ=='python':
                    root=meta.get('sitePackagesRootPath','').lstrip('/');owned=[posixpath.normpath(root+'/'+x['path']) for x in meta.get('files',[])];method='installed-wheel-file-inventory'
                    if not owned and any('.egg-info/' in p for p in primary):
                        parent=primary[0].rsplit('/',2)[0]+'/'
                        owned=[p for p in files if p.startswith(parent) and not any(p.startswith(parent+v+'/') for v in ['.git','.venv','node_modules'])];method='editable-project-tree-excluding-vendored-environments'
                    elif not owned:owned=primary;method='scanner-primary-runtime-or-metadata'
                elif typ=='npm':
                    for path in primary:
                        if not path.endswith('/package.json'):continue
                        parent=path.rsplit('/',1)[0]+'/'
                        owned.extend(p for p in files if p.startswith(parent) and '/node_modules/' not in '/'+p[len(parent):])
                    method='package-directory-excluding-nested-node-modules'
                else:owned=primary;method='scanner-primary-host-or-archive'
                owned=sorted(set(owned));existing=[p for p in owned if p in files and files[p]['type']!='5'];missing=[p for p in owned if p not in files]
                signature=sha(enc([{k:files[p].get(k) for k in ['path','sha256','type','link']} for p in existing]))
                # Relative payload signature permits byte-identical package roots to share a group.
                root=primary[0].rsplit('/',1)[0]+'/' if typ=='npm' and primary else None
                content=sha(enc([{'path':p[len(root):] if root and p.startswith(root) else p,'sha256':files[p].get('sha256'),'type':files[p]['type'],'link':files[p].get('link')} for p in existing]))
                rows.append({'image':role,'imageId':pin['imageId'],'artifactId':r['id'],'name':r['name'],'version':r['version'],'type':typ,'method':method,'installedSizeDeclared':meta.get('installedSize'),'primaryPaths':primary,'payloadSignature':signature,'relativePayloadSignature':content,'retainedFileCount':len(existing),'missingDeclaredPaths':missing,'nativePaths':[p for p in existing if p in native],'declaredSource':{k:meta[k] for k in ['source','sourceVersion','originPackage','gitCommitOfApkPort','sourceRpm'] if k in meta},'files':existing})
        print(json.dumps({'image':role,'packages':len(scan['artifacts']),'nativePayloads':len(native)}),flush=True)
    if b.container_snapshot()!=before:raise ValueError('QA changed')
    result={'schema':'stage74-step3-payload-context/v1','candidateLockSha256':b.sha(ROOT/'step3-candidate-lock.json'),'scannerInputs':inputrefs,'packages':rows,'nativePayloads':natives,'originalQAUnchanged':True,'payloadExecuted':False}
    out=ROOT/'step3-context.json';out.write_bytes(enc(result));print(json.dumps({'packages':len(rows),'nativePayloads':len(natives),'sha256':b.sha(out),'originalQAUnchanged':True}))
if __name__=='__main__':main()
