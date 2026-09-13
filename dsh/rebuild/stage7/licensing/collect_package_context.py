"""Collect package-owner context from original images, without execution or remote writes.
Run by collect_package_context.py's local entrypoint; stdout only on remote.
"""
import base64, csv, hashlib, io, json, posixpath, re, subprocess, tarfile
from pathlib import Path

BASE = Path(__file__).resolve().parent

def sha(b): return hashlib.sha256(b).hexdigest()
def norm(p):
    p = posixpath.normpath(p).lstrip('/')
    if p == '..' or p.startswith('../'): raise ValueError('Escaping image path')
    return p

def wanted(path):
    leaf=path.rsplit('/',1)[-1]
    if leaf in {'METADATA','RECORD'} and any(s in path for s in ['setuptools-83.0.0.dist-info/','pip-','hindsight_client-','discord_py-']):return True
    if leaf in {'package.json','pyproject.toml','setup.cfg','vendor.txt'} and any(s in path for s in ['opt/hermes/','opt/unify-adapter/','app/','pip/_vendor/']):
        # Only target/ancestor package manifests, not unrelated nested dependencies.
        return path in REQUEST_PATHS or path.endswith('pip/_vendor/vendor.txt')
    if path in REQUEST_PATHS:return True
    return False

def remote():
    before=snapshot()
    root=Path('/srv/alica-stage7-72297c3/bundle')
    release=json.loads((root/'release.json').read_bytes())
    if sha((root/'release.json').read_bytes())!=RELEASE_SHA:raise ValueError('Changed release')
    files=[];layers={};images={};whiteouts={};links={};seenlayers=set()
    for a in ['images.tar','reference-image.tar']:
        with (root/a).open('rb') as f:
            if digest(f)!=release['files'][a]:raise ValueError('Changed original image archive')
        with tarfile.open(root/a) as outer:
            owners={}
            for im in json.load(outer.extractfile('manifest.json')):
                ident='sha256:'+sha(outer.extractfile(im['Config']).read());images[ident]=['sha256:'+Path(l).name for l in im['Layers']]
                for l in im['Layers']:owners.setdefault(l,set()).add(ident)
            for l,ids in owners.items():
                ld='sha256:'+Path(l).name
                layers.setdefault(ld,set()).update(ids)
                if ld in seenlayers:continue
                seenlayers.add(ld)
                if 'sha256:'+digest(outer.extractfile(l))!=ld:raise ValueError('Layer mismatch')
                whiteouts[ld]=[];links[ld]=[]
                with tarfile.open(fileobj=outer.extractfile(l),mode='r|*') as t:
                    for m in t:
                        p=norm(m.name)
                        if '/.wh.' in '/'+p:whiteouts[ld].append(p)
                        if m.issym() or m.islnk():links[ld].append({'path':p,'target':m.linkname,'hardlink':m.islnk()})
                        if not wanted(p):continue
                        r={'layer':ld,'path':p,'bytes':m.size,'regular':m.isfile()}
                        if m.isfile():
                            if m.size>8*1024*1024:raise ValueError('Context text too large: '+p)
                            b=t.extractfile(m).read();r.update(sha256=sha(b),text=b.decode('utf-8'))
                        else:r.update(target=m.linkname,hardlink=m.islnk())
                        files.append(r)
    after=snapshot()
    if before!=after:raise ValueError('QA changed')
    return {'schema':'stage74-package-context/v1','releaseSha256':RELEASE_SHA,'archives':{n:release['files'][n] for n in ['images.tar','reference-image.tar']},'images':images,'layers':{k:sorted(v) for k,v in layers.items()},'files':files,'links':links,'whiteouts':whiteouts,'qaBefore':before,'qaAfter':after,'remoteWrites':False}

def request():
    q=json.loads((BASE/'original-bsd-review/review-queue.json').read_bytes())
    paths=set()
    for r in q:
        if r['reviewStatus']!='licence-metadata-unresolved':continue
        for loc in r['locations']:
            p=norm(loc['path'])
            if p.endswith(('/METADATA','/RECORD','package.json')):paths.add(p)
            if r['type']=='npm':
                parent=posixpath.dirname(p)
                while parent:
                    paths.add(parent+'/package.json');parent=posixpath.dirname(parent)
    paths.update(['opt/hermes/pyproject.toml','opt/hermes/setup.cfg'])
    return sorted(paths)

def main():
    import argparse
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path);p.add_argument('--compare',type=Path);a=p.parse_args()
    if a.output.exists():raise ValueError('Output must be new')
    source=(BASE/'reinspect_original.py').read_text().split("if __name__ == '__main__':")[0]
    source+='\nREQUEST_PATHS='+repr(set(request()))+'\n'
    source+=(BASE/'collect_package_context.py').read_text().split('def main():')[0].replace("BASE = Path(__file__).resolve().parent",'')
    source+='\nprint(json.dumps(remote(),sort_keys=True))\n'
    cmd=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/home/herman/.alica-provider-access/dsh2-stage7-known-hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@95.216.216.143','sudo -n python3 -']
    r=subprocess.run(cmd,input=source,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=560)
    if r.returncode:raise RuntimeError(r.stderr)
    result=json.loads(r.stdout)
    if a.compare and json.loads(a.compare.read_bytes())!=result:raise ValueError('Context changed')
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'files':len(result['files']),'layers':len(result['layers']),'qaUnchanged':result['qaBefore']==result['qaAfter'],'compared':bool(a.compare)}))

if __name__=='__main__':main()
