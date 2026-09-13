"""Read original archived layers to prove byte continuity for clean-candidate metadata.
Never executes a container or changes original archives. Hashes selected members,
not just package names/versions or scanner IDs.
"""
import hashlib,json,os,socket,tarfile,sys
from pathlib import Path
import build_clean_candidate as b
B=Path('/srv/alica-stage74-clean-candidate1')
def main(request_path):
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong host')
    output=B/'original-byte-continuity.json'
    if output.exists():raise ValueError('Refuse evidence overwrite')
    before=b.canonical_snapshot(json.loads((B/'original-containers.private.json').read_bytes()))
    if b.container_snapshot()!=before:raise ValueError('QA changed')
    requests=json.loads(Path(request_path).read_bytes());build=json.loads((B/'build-receipt.json').read_bytes());release=json.loads((b.ROOT/'release.json').read_bytes())
    if b.sha(b.ROOT/'release.json')!=b.RELEASE:raise ValueError('Changed original release')
    results=[];archives={}
    for role,image in build['images'].items():
        records=[r for r in requests if r['image']==role];needed={}
        for r in records:
            for loc in r['locations']:needed.setdefault(loc['layerID'],set()).add(loc['path'].lstrip('/'))
        filename='reference-image.tar' if role=='reference-application' else 'images.tar';path=b.ROOT/filename
        if b.sha(path)!=release['files'][filename]:raise ValueError('Changed original archive')
        archives[role]=release['files'][filename];found={}
        with tarfile.open(path) as outer:
            f=outer.extractfile('manifest.json')
            if f is None:raise ValueError('Missing archive manifest')
            manifests=json.load(f);matches=[]
            for manifest in manifests:
                f=outer.extractfile(manifest['Config'])
                if f is None:raise ValueError('Missing image config')
                data=f.read()
                if 'sha256:'+hashlib.sha256(data).hexdigest()==image['originalImageId']:matches.append((manifest,json.loads(data)))
            if len(matches)!=1:raise ValueError('Ambiguous original image config')
            manifest,config=matches[0]
            if len(manifest['Layers'])!=len(config['rootfs']['diff_ids']):raise ValueError('Layer count mismatch')
            for layer,name in zip(config['rootfs']['diff_ids'],manifest['Layers']):
                if layer not in needed:continue
                f=outer.extractfile(name)
                if f is None:raise ValueError('Missing original layer')
                with tarfile.open(fileobj=f,mode='r:*') as t:
                    members={b.norm(m.name):m for m in t.getmembers()}
                    for target in sorted(needed[layer]):
                        m=members.get(target)
                        if m is None or not (m.isfile() or m.islnk()):continue
                        try:
                            stream=t.extractfile(m)
                            if stream is not None:found[(layer,target)]={'image':role,'layer':layer,'path':target,'sha256':b.digest(stream)}
                        except (KeyError,tarfile.ExtractError):continue
        results.extend(found.values());print(json.dumps({'role':role,'hashedMembers':len(found)}),flush=True)
    if b.container_snapshot()!=before:raise ValueError('QA changed during read-only collection')
    result={'schema':'stage74-original-byte-continuity/v1','requestSha256':b.sha(Path(request_path)),'buildReceiptSha256':b.sha(B/'build-receipt.json'),'originalArchiveSha256':archives,'members':sorted(results,key=lambda r:(r['image'],r['layer'],r['path'])),'originalQAUnchanged':True}
    b.js(output,result);print(json.dumps({'members':len(results),'receiptSha256':b.sha(output)}),flush=True)
if __name__=='__main__':main(sys.argv[1])
