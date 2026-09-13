"""Bind standalone binary/JAR findings to the package manager's owning records."""
import hashlib,json,os,socket,tarfile
from pathlib import Path
import build_clean_candidate as b
B=Path('/srv/alica-stage74-clean-candidate1')
def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong host')
    out=B/'step2-package-owners.json'
    if out.exists():raise ValueError('Refuse overwrite')
    result=[]
    for role,name,path in [('hermes','docker-cli','usr/bin/docker'),('keycloak','java-21-openjdk-headless','usr/lib/jvm/java-21-openjdk-21.0.6.0.7-1.el9.x86_64/lib/jrt-fs.jar')]:
        scan=B/'scans'/(role+'.syft.private.json');data=json.loads(scan.read_bytes());package=next(a for a in data['artifacts'] if a['name']==name);member=next(f for f in package['metadata']['files'] if f['path'].lstrip('/')==path)
        with tarfile.open(B/role/'clean-layer.tar') as t:
            f=t.extractfile(path)
            if f is None:raise ValueError('Missing payload')
            raw=f.read()
        d=member['digest']
        if hashlib.new(d['algorithm'],raw).hexdigest()!=d['value']:raise ValueError('Installed package digest does not match')
        result.append({'image':role,'package':name,'version':package['version'],'path':path,'sha256':hashlib.sha256(raw).hexdigest(),'scanSha256':b.sha(scan),'packageDigest':d,'source':package['metadata'].get('source') or package['metadata'].get('sourceRpm'),'sourceVersion':package['metadata'].get('sourceVersion'),'digestMatches':True})
    b.js(out,result);print(json.dumps(result))
if __name__=='__main__':main()
