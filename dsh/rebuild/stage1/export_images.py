#!/usr/bin/env python3
"""Export immutable candidate images and portable config identities, without starting them.
Usage: export_images.py PACKAGE HERMES_IMAGE_REF NATIVE_GIT_REPOSITORY
The package must already contain the explicitly selected seven-image lock.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile

def export(package, hermes_ref, native_repo):
    lock=json.loads((package/'images.lock.json').read_text())
    lock['images']['hermes']['reference']=hermes_ref
    refs=[i['reference'] for i in lock['images'].values()]
    source=json.loads(subprocess.check_output(['docker','image','inspect',*refs]))
    archive=package/'images-exporting.tar'
    if archive.exists():raise RuntimeError('unfinished export exists; inspect before retry')
    subprocess.run(['docker','image','save','--output',str(archive),*refs],check=True)
    with tarfile.open(archive) as t:
        f=t.extractfile('manifest.json');assert f is not None
        manifests=json.load(f)
        for name,i in lock['images'].items():
            match=[m for m in manifests if i['reference'] in (m.get('RepoTags') or [])]
            if not match:
                # Digest-only source references are exported without a tag.
                match=[m for m in manifests if m['Config'].endswith(i['id'].removeprefix('sha256:'))]
            assert len(match)==1,(name,'ambiguous config')
            f=t.extractfile(match[0]['Config']);assert f is not None
            raw=f.read();cfg=json.loads(raw)
            assert cfg['os']=='linux' and cfg['architecture']=='amd64'
            i['id']='sha256:'+hashlib.sha256(raw).hexdigest()
            i['filesystem_diff_ids']=cfg['rootfs']['diff_ids']
            idx=refs.index(i['reference'])
            i['local_manifest_identity']=source[idx]['Id']
            i['source_backend_reported_size_bytes']=source[idx]['Size']
            i['target_config_identity_verified']=False
    h=hashlib.sha256()
    with archive.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    digest=h.hexdigest()
    destination=package/('images-'+digest+'.tar');archive.rename(destination)
    lock['archive']={'filename':destination.name,'sha256':digest,'bytes':destination.stat().st_size}
    script=Path(__file__).with_name('check_native_source.py')
    lock['native_source_check']=json.loads(subprocess.check_output([sys.executable,str(script),hermes_ref,native_repo]))
    assert lock['native_source_check']['pass']
    (package/'images.lock.json').write_text(json.dumps(lock,indent=2))
    print(json.dumps({'archive':lock['archive'],'config_identities':{k:v['id'] for k,v in lock['images'].items()},'native_source_pass':True}))

if __name__=='__main__':export(Path(sys.argv[1]),sys.argv[2],sys.argv[3])
