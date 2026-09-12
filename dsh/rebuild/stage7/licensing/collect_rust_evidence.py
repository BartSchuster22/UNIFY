"""Fetch exact crates.io source/licence evidence for embedded registry-origin Rust records.
Only public coordinates explicitly marked crates.io are queried. No inference of local/git origins.
"""
import concurrent.futures,hashlib,io,json,re,tarfile,threading,time,tomllib,urllib.request,urllib.error
from pathlib import Path
from collect_current import sha,require
B=Path('/var/lib/alica-stage74-licensing/run1');O=Path('/var/lib/alica-stage74-licensing/rust-upstream-run1')
AGENT='ALICA-DSH licensing audit (https://github.com/BartSchuster22/Alica-DSH)'
lock=threading.Lock();next_request=0.0
MAX=32*1024*1024

def get(url):
 global next_request
 for attempt in range(3):
  with lock:
   wait=max(0,next_request-time.monotonic());time.sleep(wait);next_request=time.monotonic()+0.5
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':AGENT}),timeout=45) as r:data=r.read(MAX+1)
   require(len(data)<=MAX,'Response size limit');return data
  except urllib.error.HTTPError as e:
   if e.code not in [429,500,502,503,504] or attempt==2:raise
   time.sleep(min(60,max(2**attempt,float(e.headers.get('Retry-After','2')))))
  except (TimeoutError,urllib.error.URLError):
   if attempt==2:raise
   time.sleep(2**attempt)
 raise RuntimeError('Fetch exhausted')
def inspect_source(data,name,version):
 texts=[];prefix=name+'-'+version+'/'
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as t:
  m=t.getmember(prefix+'Cargo.toml');require(m.isfile() and m.size<1048576,'Missing/oversized Cargo manifest');f=t.extractfile(m);require(f is not None,'Missing Cargo data');manifest=tomllib.loads(f.read().decode());pkg=manifest['package'];require(pkg['name']==name and pkg['version']==version,'Cargo coordinate mismatch')
  licfile=pkg.get('license-file')
  for m in t:
   p=Path(m.name)
   if not m.isfile():continue
   wanted=bool(re.match(r'^(licen[cs]es?|copying|copyrights?|notices?|authors)([._-].*)?$',p.name,re.I)) or (licfile is not None and m.name==prefix+licfile)
   if wanted:
    require(m.size<=2*1024*1024,'Oversized notice');f=t.extractfile(m);require(f is not None,'Missing notice data');body=f.read();digest=hashlib.sha256(body).hexdigest();dest=O/'texts'/digest
    # Content-addressed identical writers are harmless; all files are evidence-only.
    dest.write_bytes(body);texts.append({'path':m.name,'sha256':digest,'bytes':len(body)})
 return {'cargoDeclaredLicense':pkg.get('license'),'cargoLicenseFile':licfile,'noticeCandidates':texts}
def main():
 receipt=json.loads((B/'receipt.json').read_text());require(receipt.get('completed'),'Image scan incomplete')
 O.mkdir(parents=True,mode=0o700,exist_ok=False);(O/'crates').mkdir();(O/'texts').mkdir();targets={};other=[]
 for role,record in receipt['images'].items():
  path=B/(role+'.syft.private.json');require(sha(path)==record['syftPrivateSha256'],'Changed scanner evidence')
  for a in json.loads(path.read_text())['artifacts']:
   if a['type']!='rust-crate' or a.get('licenses'):continue
   ref={'image':role,'artifactId':a['id'],'name':a['name'],'version':a['version'],'source':a.get('metadata',{}).get('source')}
   if ref['source']!='crates.io':other.append(ref);continue
   require(re.fullmatch(r'[A-Za-z0-9_-]+',a['name']) and re.fullmatch(r'[A-Za-z0-9.+_-]+',a['version']),'Unsafe public coordinate')
   targets.setdefault((a['name'],a['version']),[]).append(ref)
 report={'schema':'stage74-rust-upstream-evidence/v1','scanReceiptSha256':sha(B/'receipt.json'),'upstreamEvidenceOnly':True,'legalReviewComplete':False,'binaryReproducibilityProven':False,'unfetchedNonRegistryRecords':other,'results':[]}
 def save():(O/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
 def fetch(item):
  (name,version),refs=item;row={'name':name,'version':version,'occurrences':refs}
  try:
   url=f'https://crates.io/api/v1/crates/{name}/{version}';metadata=get(url);d=json.loads(metadata)['version'];require(d['crate']==name and d['num']==version,'Registry coordinate mismatch')
   digest=d['checksum'];require(re.fullmatch('[a-f0-9]{64}',digest),'Invalid checksum')
   srcurl=f'https://static.crates.io/crates/{name}/{name}-{version}.crate';data=get(srcurl);require(hashlib.sha256(data).hexdigest()==digest,'Registry/archive checksum mismatch');(O/'crates'/(digest+'.crate')).write_bytes(data)
   row.update({'status':'verified-upstream-source-not-legal-clearance','metadataUrl':url,'metadataSha256':hashlib.sha256(metadata).hexdigest(),'declaredRegistryLicense':d.get('license'),'sourceUrl':srcurl,'crateSha256':digest,**inspect_source(data,name,version)})
   (O/'crates'/(digest+'.registry.json')).write_bytes(metadata)
  except Exception as e:row.update({'status':'unresolved','errorType':type(e).__name__,'error':str(e)[:300]})
  return row
 save()
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for row in pool.map(fetch,sorted(targets.items())):
   report['results'].append(row);save()
   if len(report['results'])%25==0:print(json.dumps({'processed':len(report['results']),'total':len(targets),'verified':sum(x['status'].startswith('verified') for x in report['results'])}),flush=True)
 report['completed']=True;save();print(json.dumps({'completed':True,'coordinates':len(targets),'verified':sum(x['status'].startswith('verified') for x in report['results']),'unfetchedNonRegistryOccurrences':len(other),'legalReviewComplete':False}),flush=True)
if __name__=='__main__':main()
