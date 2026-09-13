"""Collect exact Debian source-package materials for the clean candidate.
Uses observed dpkg sourceVersion, not binary binNMU versions. Authenticated HTTPS
retrieval plus complete DSC SHA256 validation; no GPG/build/relink approval claimed.
"""
import concurrent.futures,hashlib,json,os,re,socket,time,urllib.request,urllib.parse,urllib.error
from pathlib import Path
B=Path('/srv/alica-stage74-clean-candidate1')
LIMIT=300*1024*1024

def sha(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def coordinates(p):
    m=p['metadata'];name=m.get('source') or p['name'];v=m.get('sourceVersion') or p['version']
    if not re.fullmatch(r'[a-z0-9][a-z0-9+.-]*',name) or not re.fullmatch(r'[0-9A-Za-z:.+~_-]+',v):raise ValueError('Unsafe source coordinates')
    if re.search(r'\+b\d+$',v) and not m.get('sourceVersion'):raise ValueError('Unresolved binNMU source version')
    return name,v

def get(url,limit=LIMIT):
    if not url.startswith(('https://deb.debian.org/','https://snapshot.debian.org/')):raise ValueError('Unapproved source host')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'DSH-licensing-evidence/1.0'}),timeout=60) as r:
                data=r.read(limit+1)
                if len(data)>limit:raise ValueError('Source response too large')
                return data
        except urllib.error.HTTPError as e:
            if e.code not in (429,500,502,503,504):raise
            if attempt==2:raise
        except (TimeoutError,urllib.error.URLError):
            if attempt==2:raise
        time.sleep(2**attempt)

def dsc_fields(data):
    text=data.decode('utf-8');fields={};key=None
    for line in text.splitlines():
        if line.startswith('-----BEGIN PGP SIGNATURE-----'):break
        if line.startswith('- '):line=line[2:]
        if line[:1].isspace() and key:fields[key]+='\n'+line.strip()
        elif re.match(r'^[A-Za-z][A-Za-z0-9-]*:',line):key,value=line.split(':',1);fields[key]=value.strip()
        else:key=None
    return fields

def collect(item,out):
    (name,version),occurrences=item;folder=out/(name+'_'+urllib.parse.quote(version,safe=''));folder.mkdir()
    record={'name':name,'version':version,'occurrences':occurrences,'status':'unresolved','materials':[],'dscSignatureVerified':False,'correspondingSourceAccepted':False,'relinkVerified':False}
    try:
        nv=name+'_'+version.split(':')[-1];prefix=name[:4] if name.startswith('lib') else name[0]
        pool='https://deb.debian.org/debian/pool/main/'+prefix+'/'+name+'/'
        dsc_name=nv+'.dsc';dsc_url=pool+urllib.parse.quote(dsc_name);snapshot={}
        try:data=get(dsc_url,1024*1024)
        except urllib.error.HTTPError as e:
            if e.code!=404:raise
            api='https://snapshot.debian.org/mr/package/'+urllib.parse.quote(name,safe='')+'/'+urllib.parse.quote(version,safe='')+'/srcfiles'
            raw=get(api,1024*1024);(folder/'snapshot-srcfiles.json').write_bytes(raw);index=json.loads(raw)
            if index['package']!=name or index['version']!=version:raise ValueError('Snapshot coordinates differ')
            for part in index['result']:
                h=part['hash']
                if not re.fullmatch('[0-9a-f]{40}',h):raise ValueError('Unsafe snapshot identity')
                info=get('https://snapshot.debian.org/mr/file/'+h+'/info',1024*1024);(folder/(h+'.info.json')).write_bytes(info)
                for value in json.loads(info)['result']:snapshot[value['name']]=h
            if dsc_name not in snapshot:raise ValueError('Exact DSC missing from snapshot')
            dsc_url='https://snapshot.debian.org/file/'+snapshot[dsc_name];data=get(dsc_url,1024*1024)
            if hashlib.sha1(data).hexdigest()!=snapshot[dsc_name]:raise ValueError('Snapshot DSC hash mismatch')
        fields=dsc_fields(data)
        if fields.get('Source')!=name or fields.get('Version')!=version:raise ValueError('DSC coordinate mismatch')
        (folder/dsc_name).write_bytes(data);record['dsc']={'name':dsc_name,'url':dsc_url,'sha256':sha(folder/dsc_name)}
        parts=[]
        for line in fields.get('Checksums-Sha256','').splitlines():
            if not line:continue
            h,size,filename=line.split()
            if not re.fullmatch('[0-9a-f]{64}',h) or Path(filename).name!=filename or filename in ('.','..') or not 0<int(size)<=LIMIT:raise ValueError('Unsafe DSC part')
            parts.append((h,int(size),filename))
        if not parts:raise ValueError('No strong source checksums')
        if len(parts)!=len({n for _,_,n in parts}):raise ValueError('Duplicate DSC part')
        for h,size,filename in parts:
            url='https://snapshot.debian.org/file/'+snapshot[filename] if filename in snapshot else pool+urllib.parse.quote(filename)
            raw=get(url,size)
            if len(raw)!=size or hashlib.sha256(raw).hexdigest()!=h:raise ValueError('DSC source hash mismatch: '+filename)
            (folder/filename).write_bytes(raw);record['materials'].append({'name':filename,'url':url,'sha256':h,'bytes':size})
        record.update(status='exact-dsc-source-materials-collected',buildDepends=fields.get('Build-Depends'),format=fields.get('Format'),sourcePackageIdentityVerified=True)
    except Exception as e:record['error']=type(e).__name__+': '+str(e)
    (folder/'receipt.json').write_text(json.dumps(record,indent=2)+'\n');return record

def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong source collection host')
    scan=json.loads((B/'scans/receipt.json').read_bytes())
    if not scan.get('completed'):raise ValueError('Incomplete inventory')
    out=B/'debian-sources';out.mkdir(mode=0o700,exist_ok=False);groups={}
    for role,row in scan['images'].items():
        p=B/'scans'/(role+'.syft.private.json')
        if sha(p)!=row['syftSha256']:raise ValueError('Changed inventory')
        for a in json.loads(p.read_bytes())['artifacts']:
            if a['type']=='deb':groups.setdefault(coordinates(a),[]).append({'image':role,'artifactId':a['id'],'binaryPackage':a['name'],'binaryVersion':a['version'],'purl':a.get('purl')})
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures=[pool.submit(collect,item,out) for item in sorted(groups.items())]
        for f in concurrent.futures.as_completed(futures):
            r=f.result();results.append(r);print(json.dumps({'source':r['name'],'version':r['version'],'status':r['status'],'error':r.get('error')}),flush=True)
            (out/'progress.json').write_text(json.dumps({'finished':len(results),'total':len(groups)},indent=2)+'\n')
    results.sort(key=lambda r:(r['name'],r['version']))
    report={'schema':'stage74-debian-source-materials/v1','scanReceiptSha256':sha(B/'scans/receipt.json'),'results':results,'summary':{'sourcePackages':len(results),'collected':sum(r['status']=='exact-dsc-source-materials-collected' for r in results),'unresolved':sum(r['status']=='unresolved' for r in results),'binaryOccurrences':sum(len(r['occurrences']) for r in results)},'engineeringComplete':False,'sourceBuildAndRelinkAcceptance':False}
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['summary']),flush=True)
if __name__=='__main__':main()
