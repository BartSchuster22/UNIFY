"""Fetch only exact GSAP coordinate and its referenced licence page as data."""
import hashlib,io,json,tarfile,urllib.request
from pathlib import Path
BASE=Path(__file__).resolve().parent;OUT=BASE/'clean-candidate-review/step3-gsap';OUT.mkdir(exist_ok=True)
def sha(b):return hashlib.sha256(b).hexdigest()
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Stage74-licensing-evidence/1.0'}),timeout=60) as response:data=response.read(32*1024*1024);actual=response.geturl()
    h=sha(data);(OUT/'objects').mkdir(exist_ok=True);(OUT/'objects'/h).write_bytes(data);return data,{'url':url,'finalUrl':actual,'sha256':h,'bytes':len(data)}
def main():
    result={'coordinate':'pkg:npm/gsap@3.15.0','legalApproval':False,'errors':[]}
    try:
        raw,ref=get('https://registry.npmjs.org/gsap/3.15.0');meta=json.loads(raw);result['registry']=ref
        if meta['name']!='gsap' or meta['version']!='3.15.0':raise ValueError('Coordinate drift')
        raw,ref=get(meta['dist']['tarball']);result['archive']=ref
        if hashlib.sha1(raw).hexdigest()!=meta['dist']['shasum']:raise ValueError('Registry archive mismatch')
        notices=[]
        with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:
            for m in t.getmembers():
                if m.name not in ['package/package.json','package/README.md','package/LICENSE','package/LICENSE.md','package/LICENSE.txt']:continue
                f=t.extractfile(m)
                if f is None:raise ValueError('Missing member')
                data=f.read();h=sha(data);(OUT/'objects'/h).write_bytes(data);notices.append({'path':m.name,'sha256':h})
        result['documents']=notices
    except Exception as e:result['errors'].append({'stage':'exact-package','error':str(e)})
    try:
        _,ref=get('https://gsap.com/standard-license/');result['referencedPage']=ref;result['pageScope']='Current publisher page; mutable URL is not proof of historical contract terms.'
    except Exception as e:result['errors'].append({'stage':'referenced-terms','error':str(e)})
    try:
        _,ref=get('https://webflow.com/legal/terms');result['incorporatedTerms']=ref
    except Exception as e:result['errors'].append({'stage':'incorporated-terms','error':str(e)})
    (OUT/'report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
