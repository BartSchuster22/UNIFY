"""Read bounded metadata for the 34 frozen-candidate findings; never start containers."""
import hashlib,json,os,socket,tarfile,io,zipfile
from pathlib import Path
import build_clean_candidate as b
B=Path('/srv/alica-stage74-clean-candidate1')
SELECT={
'hermes':['opt/hermes/LICENSE','opt/hermes/scripts/whatsapp-bridge/package.json','opt/unify-adapter/package.json','opt/unify-adapter/node_modules/.pnpm/@aquiero+contracts@file+packages+contracts/node_modules/@aquiero/contracts/package.json','opt/hermes/.venv/lib/python3.13/site-packages/hindsight_client-0.6.1.dist-info/METADATA','opt/hermes/.venv/lib/python3.13/site-packages/hindsight_client-0.6.1.dist-info/RECORD','opt/hermes/.venv/lib/python3.13/site-packages/hindsight_client/__init__.py','opt/hermes/.git/HEAD','opt/hermes/.git/packed-refs','usr/local/include/node/node_version.h'],
'keycloak':['opt/keycloak/LICENSE.txt','opt/keycloak/lib/quarkus-run.jar','usr/lib/jvm/java-21-openjdk-21.0.6.0.7-1.el9.x86_64/lib/jrt-fs.jar','usr/lib/jvm/java-21-openjdk-21.0.6.0.7-1.el9.x86_64/release','usr/lib/jvm/java-21-openjdk-21.0.6.0.7-1.el9.x86_64/legal/java.base/LICENSE','usr/lib/jvm/java-21-openjdk-21.0.6.0.7-1.el9.x86_64/legal/java.base/ASSEMBLY_EXCEPTION'],
'memory-v4':['usr/local/lib/python3.12/LICENSE.txt','usr/local/include/python3.12/patchlevel.h'],
'reference-application':['usr/local/lib/python3.12/LICENSE.txt','usr/local/include/python3.12/patchlevel.h'],
'postgresql':['lib/apk/db/installed','usr/local/share/postgresql/COPYRIGHT','usr/local/include/postgresql/server/pg_config.h'],
'unify-core':['app/package.json','app/node_modules/.pnpm/@aquiero+contracts@file+packages+contracts/node_modules/@aquiero/contracts/package.json','nodejs/LICENSE'],
'uniui':['nodejs/LICENSE'],'caddy':[]}
def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong host')
    original=b.canonical_snapshot(json.loads((B/'original-containers.private.json').read_bytes()))
    if b.container_snapshot()!=original:raise ValueError('Original QA changed')
    out=B/'steps12-context';out.mkdir(mode=0o700);(out/'objects').mkdir();build=json.loads((B/'build-receipt.json').read_bytes());rows=[];configs={};missing=[]
    for role,paths in SELECT.items():
        image=build['images'][role];tr=json.loads((B/role/'transformation.json').read_bytes())
        if b.sha(B/role/'clean-layer.tar')!=tr['cleanLayerSha256']:raise ValueError('Changed layer')
        config=json.loads(b.cmd(['docker','image','inspect',image['imageId']]))[0]['Config']
        configs[role]={'imageId':image['imageId'],'versionEnvironment':[v for v in config.get('Env',[]) if v.split('=',1)[0] in ['NODE_VERSION','PYTHON_VERSION','PG_VERSION','PG_MAJOR','GOSU_VERSION']],'labels':{k:v for k,v in (config.get('Labels') or {}).items() if k.startswith('org.opencontainers.image.')}}
        with tarfile.open(B/role/'clean-layer.tar') as t:
            for path in paths:
                try:m=t.getmember(path)
                except KeyError:missing.append({'image':role,'path':path});continue
                if not m.isfile() or m.size>20*1024*1024:raise ValueError('Unexpected metadata member')
                f=t.extractfile(m)
                if f is None:raise ValueError('Unreadable member')
                data=f.read();h=hashlib.sha256(data).hexdigest();(out/'objects'/h).write_bytes(data);r={'image':role,'imageId':image['imageId'],'path':path,'sha256':h,'bytes':len(data)}
                if path.endswith('.jar'):
                    with zipfile.ZipFile(io.BytesIO(data)) as z:
                        r['members']=z.namelist();r['textMembers']={n:z.read(n).decode('utf-8','replace') for n in z.namelist() if n.upper().endswith(('MANIFEST.MF','LICENSE','NOTICE','POM.PROPERTIES')) and z.getinfo(n).file_size<65536}
                rows.append(r)
    if b.container_snapshot()!=original:raise ValueError('QA changed during collection')
    b.js(out/'report.json',{'schema':'stage74-step2-context/v1','buildReceiptSha256':b.sha(B/'build-receipt.json'),'files':rows,'imageMetadata':configs,'missingPaths':missing,'originalQAUnchanged':True});print(json.dumps({'files':len(rows),'missingPaths':missing,'originalQAUnchanged':True}))
if __name__=='__main__':main()
