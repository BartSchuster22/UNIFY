#!/usr/bin/env python3
"""Bounded ALICA-v1 fresh-install engineering assembler; no target build or live mutation.

Exports exact running dev3 image IDs, not container filesystems or mounted data.
Authenticates all predecessor files, replaces installer code from a clean Git pin,
verifies exported config/layer identities, signs QA-only fresh-install admission.
Does not install, publish publicly, qualify licensing, or grant production status.
"""
import argparse, gzip, hashlib, json, os, shutil, socket, subprocess, sys, tarfile, time
from pathlib import Path, PurePosixPath

GIB=1024**3
SERVICES={'hermes','unify-core','uniui','memory-v4','caddy','keycloak','postgresql'}

def digest(path):
    with Path(path).open('rb') as f:return stream_digest(f)

def stream_digest(f):
    h=hashlib.sha256()
    for b in iter(lambda:f.read(1024**2),b''):h.update(b)
    return h.hexdigest()

def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()

def inspect_export(path, expected):
    """Verify every config and ordered uncompressed layer; derive truthful OCI manifests."""
    with tarfile.open(path) as t:
        names=t.getnames()
        assert len(names)==len(set(names)), 'Duplicate Docker export members'
        for m in t:
            assert not PurePosixPath(m.name).is_absolute() and '..' not in PurePosixPath(m.name).parts
            assert m.isfile() or m.isdir(), 'Special/link Docker export member'
        def get(name):
            m=t.getmember(name);assert m.isfile();return m,t.extractfile(m)
        _,f=get('manifest.json');rows=json.load(f)
        by_id={};layers={}
        for row in rows:
            cm,cf=get(row['Config']);raw=cf.read();cid='sha256:'+hashlib.sha256(raw).hexdigest()
            assert cid not in by_id, 'Repeated image config'
            config=json.loads(raw);diffs=config['rootfs']['diff_ids']
            assert config['rootfs']['type']=='layers' and len(diffs)==len(row['Layers'])
            assert config.get('os')=='linux' and config.get('architecture')=='amd64'
            descriptors=[]
            for name,want in zip(row['Layers'],diffs):
                if name not in layers:
                    lm,lf=get(name);magic=lf.read(2);lf.close()
                    _,lf=get(name);stored=stream_digest(lf);lf.close()
                    _,lf=get(name)
                    if magic==b'\x1f\x8b':
                        with gzip.GzipFile(fileobj=lf) as gz:unpacked=stream_digest(gz)
                    else:unpacked=stored
                    lf.close()
                    layers[name]=('sha256:'+unpacked,{'mediaType':'application/vnd.oci.image.layer.v1.tar'+('+gzip' if magic==b'\x1f\x8b' else ''),'digest':'sha256:'+stored,'size':lm.size})
                actual,descriptor=layers[name];assert actual==want,'Layer diffID mismatch'
                descriptors.append(descriptor)
            manifest={'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json','config':{'mediaType':'application/vnd.oci.image.config.v1+json','digest':cid,'size':cm.size},'layers':descriptors}
            by_id[cid]={'manifest':manifest,'diff_ids':diffs,'config':config}
        assert set(by_id)==set(expected.values()),'Export does not contain exactly the requested image IDs'
        return {role:by_id[cid] for role,cid in expected.items()}

class GuardedWriter:
    def __init__(self,raw,reserve,limit):self.raw=raw;self.reserve=reserve;self.limit=limit;self.total=0
    def write(self,b):
        assert self.total+len(b)<=self.limit,'Artifact size budget exceeded'
        assert shutil.disk_usage(Path(self.raw.name).parent).free>=self.reserve+len(b),'Disk reserve reached'
        n=self.raw.write(b);self.total+=n;return n
    def flush(self):return self.raw.flush()
    def tell(self):return self.raw.tell()

def run(*args):return subprocess.check_output(args,text=True)

def state():
    ids=run('docker','ps','-aq').split()
    rows=json.loads(run('docker','inspect',*ids))
    return {c['Id']:{'name':c['Name'],'image':c['Image'],'running':c['State']['Running'],'startedAt':c['State']['StartedAt'],'restartCount':c['RestartCount']} for c in rows}

def build(a):
    assert os.geteuid()==0 and socket.gethostname()=='ALICA-v1','Designated root builder only'
    repo=Path(__file__).resolve().parents[3]
    assert run('git','-C',str(repo),'rev-parse','HEAD').strip()==a.revision
    assert not run('git','-C',str(repo),'status','--porcelain').strip(),'Clean pinned source required'
    base=Path(a.base);out=Path(a.output);publisher=Path(a.publisher)
    assert not out.exists() and not publisher.exists(),'Refuse output or publisher replacement'
    assert digest(base/'release.json')==a.base_sha256,'Predecessor pin mismatch'
    original=json.loads((base/'release.json').read_text())
    for n,h in original['files'].items():
        assert Path(n).name==n and not (base/n).is_symlink() and digest(base/n)==h,'Predecessor file mismatch: '+n
    reserve=a.reserve_gib*GIB
    before=state();current=[(cid,v) for cid,v in before.items() if v['name'].startswith('/dsh2-internal-dev3-') and v['running']]
    ids={}
    for cid,v in current:
        c=json.loads(run('docker','inspect',cid))[0]
        assert c['Config']['Labels']['com.docker.compose.project']=='dsh2-internal-dev3'
        role=c['Config']['Labels']['com.docker.compose.service'];assert role not in ids
        assert c['State'].get('Health',{}).get('Status')=='healthy'
        ids[role]=v['image']
    assert set(ids)==SERVICES
    assert ids=={k:v['id'] for k,v in original['images'].items()},'Live image set differs from manifest'
    ims={k:json.loads(run('docker','image','inspect',v))[0] for k,v in ids.items()}
    estimate=sum(v['Size'] for v in ims.values())
    assert shutil.disk_usage('/').free>estimate+2*GIB+reserve,'Insufficient bounded packaging capacity'
    out.mkdir(mode=0o755);bundle=out/'bundle';bundle.mkdir(mode=0o755)
    (out/'protection-before.json').write_text(json.dumps(before,sort_keys=True,indent=2)+'\n')
    start_free=shutil.disk_usage('/').free
    with (bundle/'images.tar').open('xb') as f:
        writer=GuardedWriter(f,reserve,5*GIB)
        p=subprocess.Popen(['docker','save',*sorted(set(ids.values()))],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            for b in iter(lambda:p.stdout.read(1024**2),b''):writer.write(b)
            assert p.wait(timeout=120)==0,'Docker image export failed'
        except BaseException:
            p.kill();p.wait();raise
    exported=inspect_export(bundle/'images.tar',ids)
    sys.path.insert(0,str(repo/'dsh/rebuild/stage7'))
    from package import fix_installer,fix_operations,LIFECYCLE_CLI
    for n in ['compose.template.json','frameworks.json','doghouse-dsh.tar']:
        shutil.copyfile(base/n,bundle/n)
    for n,stage in [('render.py','stage2'),('tls_lifecycle.py','stage2'),('transaction.py','stage2'),('recover_owner.py','stage2')]:
        shutil.copyfile(repo/'dsh/rebuild'/stage/n,bundle/n)
    (bundle/'install.py').write_text(fix_installer((repo/'dsh/rebuild/stage2/install.py').read_text()))
    ops=fix_operations((repo/'dsh/rebuild/stage5/ops.py').read_text())
    assert ops.count('from doghouse_dsh.broker import signature')==1
    ops=ops.replace('from doghouse_dsh.broker import signature','from doghouse_dsh.identity import canonical_signature as signature, SCHEMA')
    assert ops.count("cfg={'root':str(root)")==1
    ops=ops.replace("cfg={'root':str(root)","cfg={'signatureSchema':SCHEMA,'root':str(root)")
    (bundle/'ops.py').write_text(ops);(bundle/'alicactl').write_text(LIFECYCLE_CLI);(bundle/'alicactl').chmod(0o755)
    template=json.loads((bundle/'compose.template.json').read_text())
    assert 'ipam' not in template['networks']['application'],'Inherited QA subnet'
    assert template['services']['unify-core']['environment']['APPLICATION_CALLBACK_PINS_JSON']=='{}','Inherited QA callback pin'
    images={}
    for role,item in exported.items():
        raw=canonical(item['manifest']);mh=hashlib.sha256(raw).hexdigest()
        (bundle/(role+'.oci-manifest.json')).write_bytes(raw)
        images[role]={'id':ids[role],'os':'linux','architecture':'amd64','size_bytes':ims[role]['Size'],'filesystem_diff_ids':item['diff_ids'],'oci_reference':'alica-onboarding/'+role+'@sha256:'+mh,'oci_distribution':'Offline verified manifest/config/layers in images.tar; registry availability not asserted','reference':ids[role]}
    release={'schema':'dsh-stage2-bundle/v1','release':'internal-onboarding1-'+a.revision[:8],'images':images,'files':{p.name:digest(p) for p in sorted(bundle.iterdir())},'acceptance':'UNQUALIFIED fresh-install internal engineering candidate; not production or distribution approved','installer_revision':a.revision,'source_revisions':{'installer':a.revision,'runtime_inputs':original.get('source_revisions',{})},'internalDevelopment':{'sourceHead':a.revision,'sourceDirty':False,'scope':'Isolated DSH2 owner-onboarding engineering candidate','baseReleaseSha256':a.base_sha256,'freshInstallArtifact':True,'runtimeImageSetVerified':True,'runtimeReproducibleBuildAccepted':False,'licensingReviewResumed':False,'copiedOwnerProviderOrQAState':False}}
    for key in ['application_contract','operations_contract','workflow_contract','lifecycle_protocol']:
        if key in original:release[key]=original[key]
    (bundle/'release.json').write_text(json.dumps(release,indent=2,sort_keys=True)+'\n')
    release_sha=digest(bundle/'release.json');(bundle/'release.sha256').write_text(release_sha+'  release.json\n')
    archive=out/(release['release']+'-linux-amd64.tar.gz')
    with archive.open('xb') as raw:
        guarded=GuardedWriter(raw,reserve,4*GIB)
        with gzip.GzipFile(filename='',mode='wb',fileobj=guarded,mtime=0,compresslevel=1) as gz:
            with tarfile.open(fileobj=gz,mode='w|',format=tarfile.USTAR_FORMAT) as t:
                for path in sorted(bundle.iterdir()):
                    info=t.gettarinfo(path,arcname='bundle/'+path.name);info.uid=info.gid=info.mtime=0;info.uname=info.gname='root';info.mode=0o755 if path.name=='alicactl' else 0o644
                    with path.open('rb') as f:t.addfile(info,f)
    # Re-read compressed artifact without another extracted copy.
    count=0
    with tarfile.open(archive,'r|gz') as t:
        for m in t:
            assert m.isfile() and m.name=='bundle/'+Path(m.name).name
            assert stream_digest(t.extractfile(m))==digest(bundle/Path(m.name).name)
            count+=1
    assert count==len(list(bundle.iterdir()))
    sys.path.insert(0,str(repo/'dsh/rebuild/stage6'));import release_trust as rt
    publisher.mkdir(mode=0o700)
    rt.keygen(publisher/'signing-key.pem',publisher/'candidate-trust.json','qa')
    now=int(time.time());payload={'schema':'alica-release-admission/v1','scope':'qa','sequence':1,'issuedAt':now,'expiresAt':now+7*86400,'platform':'linux/amd64','acceptedPredecessors':['0'*64],'artifacts':rt.inventory(bundle),'releaseSha256':release_sha}
    envelope=rt.sign(payload,publisher/'signing-key.pem')
    (out/'candidate-envelope.json').write_text(json.dumps(envelope,indent=2)+'\n')
    verified=rt.verify(envelope,rt.load(publisher/'candidate-trust.json'),bundle,'0'*64,0,'qa')
    after=state();assert before==after,'Existing container identity/state changed'
    result={'schema':'alica-onboarding-build/v1','sourceRevision':a.revision,'baseReleaseSha256':a.base_sha256,'archive':archive.name,'archiveSha256':digest(archive),'archiveBytes':archive.stat().st_size,'exportBytes':(bundle/'images.tar').stat().st_size,'releaseSha256':release_sha,'trustSha256':digest(publisher/'candidate-trust.json'),'imageIds':ids,'fileCount':count,'scope':'qa','signatureVerified':verified['signatureVerified'],'allExportedConfigsAndLayersVerified':True,'archiveReadbackVerified':True,'existingContainersUnchanged':len(before),'startFreeBytes':start_free,'endFreeBytes':shutil.disk_usage('/').free,'diskReserveBytes':reserve,'productionAccepted':False,'distributionApproved':False,'freshInstallAccepted':False,'installationPerformed':False}
    (out/'build-receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['base','base-sha256','output','publisher','revision']:p.add_argument('--'+name,required=True)
    p.add_argument('--reserve-gib',type=int,default=3)
    build(p.parse_args())
