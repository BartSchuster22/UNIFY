"""Independently verify completed clean images, including an ordering-only guard failure.
Never overwrite the original build receipt or original QA evidence.
"""
import json,os,socket,tarfile
from pathlib import Path
import build_clean_candidate as b
B=Path('/srv/alica-stage74-clean-candidate1')
def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong host/user')
    output=B/'build-verification.json'
    if output.exists():raise ValueError('Refuse verification replacement')
    before=b.canonical_snapshot(json.loads((B/'original-containers.private.json').read_bytes()))
    if b.container_snapshot()!=before:raise ValueError('Original container facts changed')
    if b.sha(b.ROOT/'release.json')!=b.RELEASE:raise ValueError('Original release changed')
    release=json.loads((b.ROOT/'release.json').read_bytes());r=json.loads((B/'build-receipt.json').read_bytes())
    expected={**{k:v['id'] for k,v in release['images'].items()},'reference-application':'sha256:453f59474c73eda86bdb3dcdcaebb0928bf593c86700da9a9ad2449ed52dec61'}
    if {k:v['originalImageId'] for k,v in r['images'].items()}!=expected:raise ValueError('Wrong role/source coverage')
    checks=[]
    for role,row in r['images'].items():
        p=B/role
        for n,key in [('image.tar','archiveSha256'),('transformation.json','transformationSha256')]:
            if b.sha(p/n)!=row[key]:raise ValueError('Changed output: '+role+'/'+n)
        t=json.loads((p/'transformation.json').read_bytes())
        if b.sha(p/'clean-layer.tar')!=t['cleanLayerSha256'] or b.sha(p/'original-export.tar')!=t['sourceExportSha256']:raise ValueError('Changed filesystem export')
        actual=json.loads(b.cmd(['docker','image','inspect',row['tag']]))[0];original=json.loads(b.cmd(['docker','image','inspect',row['originalImageId']]))[0]
        if actual['Id']!=row['imageId'] or actual['Config']!=original['Config'] or actual['RootFS']['Layers']!=['sha256:'+t['cleanLayerSha256']]:raise ValueError('Changed image/config/layers')
        with tarfile.open(p/'image.tar') as archive:
            manifests=json.load(archive.extractfile('manifest.json'))
            if len(manifests)!=1 or manifests[0]['RepoTags']!=[row['tag']]:raise ValueError('Wrong archive image')
            m=manifests[0]
            if 'sha256:'+b.digest(archive.extractfile(m['Config']))!=row['imageId'] or len(m['Layers'])!=1 or b.digest(archive.extractfile(m['Layers'][0]))!=t['cleanLayerSha256']:raise ValueError('Wrong packaged image/config/layer')
        with tarfile.open(p/'clean-layer.tar') as layer:
            expected_files={v['path']:v for v in t['retained']};seen=set()
            for m in layer:
                n=b.norm(m.name)
                if n in seen or b.removed(n) or m.islnk():raise ValueError('Unexpected/removed retained path')
                seen.add(n);e=expected_files[n]
                if (m.mode,m.uid,m.gid,m.size,m.type.decode(),m.linkname)!=(e['mode'],e['uid'],e['gid'],e['bytes'],e['type'],e['link']):raise ValueError('Changed retained metadata')
                if m.isfile() and b.digest(layer.extractfile(m))!=e['sha256']:raise ValueError('Changed retained bytes')
            if seen!=set(expected_files):raise ValueError('Missing retained paths')
        checks.append({'role':role,'imageId':row['imageId'],'archiveVerified':True,'configPreserved':True,'singleLayer':True,'retainedContentVerified':True,'approvedRemovalsAbsent':True})
    for name,h in release['files'].items():
        if b.sha(b.ROOT/name)!=h:raise ValueError('Original bundle changed')
    if b.container_snapshot()!=before:raise ValueError('Original QA changed during verification')
    result={'schema':'stage74-clean-build-verification/v1','buildReceiptSha256':b.sha(B/'build-receipt.json'),'builderSha256':b.sha(Path(b.__file__)),'verifierSha256':b.sha(Path(__file__)),'images':checks,'buildComplete':True,'originalContainersUnchanged':True,'originalBundleUnchanged':True,'normalization':'Docker mount/container ordering only; all other fields compared exactly','runtimeAccepted':False,'engineeringComplete':False}
    b.js(output,result);print(json.dumps(result),flush=True)
if __name__=='__main__':main()
