"""Exact-coordinate upstream declarations; never a binary match or legal clearance."""
import concurrent.futures, hashlib, json, re, tarfile, threading, time
import urllib.request, urllib.parse, xml.etree.ElementTree as ET
from pathlib import Path
BASE=Path(__file__).resolve().parent
OUT=BASE/'registry-review'
LOCK=threading.Lock()
SOURCES={}
NS={'m':'http://maven.apache.org/POM/4.0.0'}
HOSTS={'repo.maven.apache.org','pypi.org'}
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  if urllib.parse.urlsplit(newurl).scheme!='https' or urllib.parse.urlsplit(newurl).hostname not in HOSTS:raise ValueError('Unapproved redirect')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def get(url):
 if urllib.parse.urlsplit(url).hostname not in HOSTS:raise ValueError('Unapproved host')
 with LOCK:
  existing=SOURCES.get(url)
 if existing:return (OUT/'objects'/existing['sha256']).read_bytes(),existing
 data=b''
 for attempt in range(3):
  try:
   with urllib.request.build_opener(Redirect()).open(urllib.request.Request(url,headers={'User-Agent':'ALICA-compliance-evidence/1.0'}),timeout=25) as f:data=f.read(4*1024*1024+1)
   if len(data)>4*1024*1024:raise ValueError('Response too large')
   break
  except Exception:
   if attempt==2:raise
   time.sleep(attempt+1)
 h=hashlib.sha256(data).hexdigest();record={'url':url,'sha256':h,'bytes':len(data)}
 with LOCK:
  target=OUT/'objects'/h
  if not target.exists():target.write_bytes(data)
  SOURCES[url]=record
 return data,record
def coordinate(value):
 if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.+\-]*',value) or '..' in value:raise ValueError('Unsafe/unresolved coordinate')
 return value
def pom(group,artifact,version,seen=()):
 key=(coordinate(group),coordinate(artifact),coordinate(version))
 if key in seen or len(seen)>10:raise ValueError('Parent cycle/depth')
 url='https://repo.maven.apache.org/maven2/'+group.replace('.','/')+'/'+artifact+'/'+version+'/'+artifact+'-'+version+'.pom'
 data,source=get(url)
 if b'<!DOCTYPE' in data or b'<!ENTITY' in data:raise ValueError('Unsafe XML')
 root=ET.fromstring(data)
 prefix='{http://maven.apache.org/POM/4.0.0}' if root.tag.startswith('{') else ''
 def xp(path):return '/'.join(prefix+p for p in path.split('/'))
 def text(path):return (root.findtext(xp(path),'') or '').strip()
 parent=tuple(text('parent/'+k) for k in ['groupId','artifactId','version'])
 props={'project.version':version,'pom.version':version,'project.groupId':group,'pom.groupId':group}
 node=root.find(xp('properties'))
 if node is not None:
  props.update({c.tag.split('}')[-1]:(c.text or '').strip() for c in node})
 def expand(v):
  for _ in range(5):
   n=re.sub(r'\$\{([^}]+)\}',lambda m:props.get(m[1],m[0]),v)
   if n==v:break
   v=n
  return v
 actual=tuple(expand(text(k) or (parent[i] if i!=1 else '')) for i,k in enumerate(['groupId','artifactId','version']))
 if actual!=key:raise ValueError('POM identity mismatch: '+repr(actual))
 licences=[]
 for n in root.findall(xp('licenses/license')):
  row={k:expand((n.findtext(xp(k),'') or '').strip()) for k in ['name','url','distribution','comments']}
  if row['name'] or row['url']:licences.append(row)
 if licences:return licences,[source],False
 if all(parent):
  licences,chain,_=pom(*(expand(v) for v in parent),seen=seen+(key,))
  return licences,[source]+chain,True
 return [],[source],False
def normalized(name):return re.sub(r'[-_.]+','-',name).lower()
def pypi(name,version):
 coordinate(name);coordinate(version)
 data,source=get('https://pypi.org/pypi/'+urllib.parse.quote(name,safe='')+'/'+urllib.parse.quote(version,safe='')+'/json');info=json.loads(data)['info']
 if normalized(info['name'])!=normalized(name) or info['version']!=version:raise ValueError('PyPI identity mismatch')
 values={'license_expression':info.get('license_expression'),'license':info.get('license'),'license_classifiers':[s for s in info.get('classifiers',[]) if s.startswith('License ::')]}
 if values['license'] in [None,'','UNKNOWN','NOASSERTION']:values.pop('license',None)
 if not values['license_expression']:values.pop('license_expression',None)
 if not values['license_classifiers']:values.pop('license_classifiers',None)
 return ([values] if values else []),[source],False
def collect(purl):
 result={'purl':purl,'legalDispositionApproved':False,'binaryIdentityProven':False}
 try:
  raw=urllib.parse.unquote(purl.split('?',1)[0]);path,version=raw.rsplit('@',1)
  if raw.startswith('pkg:maven/'):
   group,artifact=path.removeprefix('pkg:maven/').split('/');licences,sources,inherited=pom(group,artifact,version)
  elif raw.startswith('pkg:pypi/'):licences,sources,inherited=pypi(path.removeprefix('pkg:pypi/'),version)
  else:raise ValueError('Unsupported ecosystem')
  result.update(declarations=licences,sources=sources,inheritedFromParent=inherited,status='upstream-declaration-observed' if licences else 'no-upstream-declaration')
 except Exception as e:result.update(status='unresolved',error=str(e))
 return result
def main():
 global OUT
 import argparse
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=OUT);OUT=parser.parse_args().output
 OUT.mkdir(exist_ok=False);(OUT/'objects').mkdir()
 archive=BASE/'current-qa4/review-evidence.tar.gz'
 expected=json.loads((BASE/'current-qa4/export.json').read_text())['files']['review-evidence.tar.gz']['sha256']
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise ValueError('Input evidence changed')
 with tarfile.open(archive) as t:
  f=t.extractfile('verified-run1/review-queue.json')
  if f is None:raise ValueError('Missing input queue')
  queue=json.load(f)
 purls=sorted({r['purl'] for r in queue if r['reviewStatus']=='licence-metadata-unresolved' and r['type'] in ['java-archive','python']})
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:results=list(pool.map(collect,purls))
 index={r['purl']:r for r in results};added=0
 for r in queue:
  evidence=index.get(r['purl'])
  if r['reviewStatus']=='licence-metadata-unresolved' and evidence and evidence['status']=='upstream-declaration-observed':
   r['registryEvidence']=evidence;r['reviewStatus']='upstream-declaration-observed-obligations-unreviewed';added+=1
  elif evidence:r['registryLookup']=evidence
 report={'schema':'stage74-registry-declarations/v1','inputArchiveSha256':expected,'coordinates':len(results),'results':results,'sources':sorted(SOURCES.values(),key=lambda x:x['url']),'addedMetadataOccurrences':added,'remainingMissingMetadata':sum(r['reviewStatus']=='licence-metadata-unresolved' for r in queue),'stage74Accepted':False,'legalReviewComplete':False,'limitations':['Registry declarations do not establish equality with shipped binaries or complete notices/source obligations','Maven parent declarations are retained as inherited evidence, not silently normalized SPDX licences','PyPI declarations are retained verbatim; classifiers may be broader than actual applicable licences']}
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');(OUT/'review-queue.json').write_text(json.dumps(queue,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k not in ['results','sources']},indent=2))
if __name__=='__main__':main()
