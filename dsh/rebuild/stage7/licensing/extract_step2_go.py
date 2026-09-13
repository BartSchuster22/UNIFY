"""Extract inline Go compiler identity without executing the binaries."""
import hashlib,json,os,socket,tarfile
from pathlib import Path
import build_clean_candidate as b
B=Path('/srv/alica-stage74-clean-candidate1')
def varstr(data,pos):
    n=0;shift=0
    for _ in range(10):
        c=data[pos];pos+=1;n|=(c&127)<<shift
        if not c&128:break
        shift+=7
    else:raise ValueError('Invalid Go varint')
    end=pos+n
    if end>len(data):raise ValueError('Truncated Go build info')
    return data[pos:end],end

def decode(data):
    pos=data.find(b'\xff Go buildinf:')
    if pos<0 or not data[pos+15]&2:raise ValueError('Unsupported Go build-info encoding')
    version,p=varstr(data,pos+32);module,_=varstr(data,p)
    if len(module)<32:raise ValueError('No module information')
    return {'compiler':version.decode(),'moduleInfo':module[16:-16].decode()}
def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong host')
    dest=B/'step2-go-identities.json'
    if dest.exists():raise ValueError('Refuse overwrite')
    before=b.container_snapshot();rows=[]
    for role,path in [('caddy','usr/bin/caddy'),('hermes','usr/bin/docker'),('postgresql','usr/local/bin/gosu')]:
        transform=json.loads((B/role/'transformation.json').read_bytes())
        if b.sha(B/role/'clean-layer.tar')!=transform['cleanLayerSha256']:raise ValueError('Changed layer')
        with tarfile.open(B/role/'clean-layer.tar') as t:
            f=t.extractfile(path)
            if f is None:raise ValueError('Missing binary')
            data=f.read()
        row={'image':role,'path':path,'sha256':hashlib.sha256(data).hexdigest(),**decode(data)};rows.append(row)
    if before!=b.container_snapshot():raise ValueError('QA changed')
    b.js(dest,rows);print(json.dumps(rows))
if __name__=='__main__':main()
