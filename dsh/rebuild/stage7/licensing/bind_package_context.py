"""Bind package-owner metadata without treating dependency containment as permission.
Only explicit npm workspace membership, bounded packaged fixtures, and SHA256/size
verified wheel RECORD ownership are accepted. Raw Go documents remain separately
counted as unclassified; they never clear a missing SPDX metadata gap here.
"""
import argparse,base64,collections,csv,email,fnmatch,hashlib,io,json,posixpath,re,tarfile
from pathlib import Path
import bind_original_maven as original
import match_original_bsd as previous

BASE=Path(__file__).resolve().parent
OUT=BASE/'package-context-review'
def sha(b):return hashlib.sha256(b).hexdigest()
def norm(p):
    p=posixpath.normpath(p).lstrip('/')
    if p=='..' or p.startswith('../'):raise ValueError('Image path escape')
    return p

def validate_context(c,orig):
    if c['schema']!='stage74-package-context/v1' or c['releaseSha256']!=orig['releaseSha256']:raise ValueError('Changed context identity')
    if c['images']!=orig['images'] or c['qaBefore']!=c['qaAfter'] or c['qaBefore']!=orig['qaBefore'] or c['remoteWrites'] is not False:raise ValueError('Changed image/QA state')
    if c['archives']!={a:orig['bundleMembers']['bundle/'+a] for a in ['images.tar','reference-image.tar']}:raise ValueError('Changed archives')
    if c['layers']!={l:sorted(set(r['images'])) for l,r in orig['layers'].items()}:raise ValueError('Changed layer ownership')
    index={}
    for r in orig['files']+c['files']:
        key=(r['layer'],norm(r['path']))
        if key in index and r.get('sha256')!=index[key].get('sha256'):raise ValueError('Conflicting originals')
        if 'text' in r and (sha(r['text'].encode())!=r['sha256'] or len(r['text'].encode())!=r['bytes']):raise ValueError('Changed package text')
        if r['layer'] not in c['layers']:raise ValueError('Unknown layer')
        index[key]=r
    return index

def resolve(c,index,image,path,at,seen=()):
    path=norm(path);chain=c['images'][image]
    if len(seen)>32 or (path,at) in seen:return None
    seen=seen+((path,at),)
    for j in range(at,-1,-1):
        layer=chain[j];r=index.get((layer,path))
        if r and r['regular']:return r
        links={x['path']:x for x in c['links'].get(layer,[])}
        if path in links:
            link=links[path];target=norm(link['target'] if link['hardlink'] or link['target'].startswith('/') else posixpath.join(posixpath.dirname(path),link['target']))
            return resolve(c,index,image,target,j if link['hardlink'] else at,seen)
        parts=path.split('/')
        blocked={posixpath.join(*parts[:k],'.wh.'+parts[k]) for k in range(len(parts))}|{posixpath.join(*parts[:k],'.wh..wh..opq') for k in range(len(parts))}
        if blocked & set(c['whiteouts'].get(layer,[])):return None
    return None

def ref(r):return {k:r[k] for k in ['layer','path','sha256']}
def workspace_match(path,pattern):
    return not pattern.startswith('!') and len(path.split('/'))==len(pattern.split('/')) and all(fnmatch.fnmatchcase(p,g) for p,g in zip(path.split('/'),pattern.split('/')))

def npm_owner(row,loc,c,index,image):
    chain=c['images'][image];at=chain.index(loc['layerID']);path=norm(loc['path'])
    r=resolve(c,index,image,path,at)
    if not r or 'text' not in r:return None
    child=json.loads(r['text'])
    if child.get('name')!=row['name'] or child.get('version','UNKNOWN')!=row['version'] or child.get('license') or child.get('licenses'):return None
    directory=posixpath.dirname(path);parent=posixpath.dirname(directory)
    # Do not climb out of a node_modules package and borrow the application's licence.
    while parent:
        if parent.endswith('node_modules') or '/node_modules/@' in parent and parent.rsplit('/',1)[-1].startswith('@'):break
        owner=resolve(c,index,image,parent+'/package.json',at)
        if owner and 'text' in owner:
            meta=json.loads(owner['text']);relative=directory[len(parent)+1:];ws=meta.get('workspaces',[])
            if isinstance(ws,dict):ws=ws.get('packages',[])
            included=any(workspace_match(relative,w) for w in ws if isinstance(w,str)) and not any(workspace_match(relative,w[1:]) for w in ws if isinstance(w,str) and w.startswith('!'))
            fixture='/node_modules/' in '/'+parent and relative.split('/')[0] in {'test','tests','example','examples','benchmarks'}
            if isinstance(meta.get('license'),str) and (included or fixture):
                return {'relation':'explicit-workspace-root-declaration' if included else 'enclosing-distributed-fixture-package-declaration','declaredLicence':meta['license'],'ownerName':meta.get('name'),'ownerVersion':meta.get('version'),'ownerManifest':ref(owner),'childManifest':ref(r),'isChildStandaloneLicenceDeclaration':False,'legalDispositionApproved':False}
            # A distinct licensed nested package cannot be crossed to borrow a higher licence.
            if meta.get('license') or meta.get('licenses'):return None
        parent=posixpath.dirname(parent)
    return None

def record_contains(text,relative,binary):
    found=[]
    for fields in csv.reader(io.StringIO(text)):
        if len(fields)!=3:raise ValueError('Malformed RECORD')
        if fields[0]!=relative:continue
        found.append(fields)
    if len(found)!=1:return False
    _,h,size=found[0]
    if not h.startswith('sha256=') or not size.isdigit():return False
    expected=base64.urlsafe_b64encode(bytes.fromhex(binary['sha256'])).decode().rstrip('=')
    return h=='sha256='+expected and int(size)==binary['bytes']

def wheel_owner(row,loc,c,index,image):
    # This precise first-party setuptools path excludes nested vendored code.
    path=norm(loc['path'])
    m=re.fullmatch(r'(.+)/setuptools/((?:cli|gui)(?:-32|-64|-arm64)?\.exe)',path)
    if not m:return None
    root,leaf=m.groups();at=c['images'][image].index(loc['layerID']);binary=resolve(c,index,image,path,at)
    meta=resolve(c,index,image,root+'/setuptools-83.0.0.dist-info/METADATA',at)
    record=resolve(c,index,image,root+'/setuptools-83.0.0.dist-info/RECORD',at)
    if not binary or not meta or not record or 'text' not in meta or 'text' not in record:return None
    msg=email.message_from_string(meta['text'])
    if msg['Name']!='setuptools' or msg['Version']!='83.0.0' or msg['License-Expression']!='MIT':return None
    if not record_contains(record['text'],'setuptools/'+leaf,binary):return None
    return {'relation':'sha256-and-size-verified-wheel-RECORD-ownership','ownerName':'setuptools','ownerVersion':'83.0.0','declaredLicence':'MIT','metadata':ref(meta),'record':ref(record),'binary':ref(binary),'legalDispositionApproved':False}

def derive():
    previous.run(verify=True)
    queue=json.loads((BASE/'original-bsd-review/review-queue.json').read_bytes());orig=json.loads((BASE/'original-review/inspection.json').read_bytes());c=json.loads((OUT/'context.json').read_bytes());index=validate_context(c,orig)
    with tarfile.open(BASE/'current-qa4/review-evidence.tar.gz') as t:images=json.load(t.extractfile('run1/receipt.json'))['images']
    added=collections.Counter()
    for row in queue:
        if row['reviewStatus']!='licence-metadata-unresolved' or row['type'] not in {'npm','binary'}:continue
        refs=[];image=images[row['image']]['imageId']
        for loc in row['locations']:
            if loc['layerID'] not in c['images'][image]:raise ValueError('Foreign image layer')
            r=(npm_owner if row['type']=='npm' else wheel_owner)(row,loc,c,index,image)
            if not r:refs=[];break
            refs.append(r)
        if refs:
            row['packageOwnerMetadataEvidence']=refs;row['reviewStatus']='verified-package-owner-metadata-observed-obligations-unreviewed';added[row['type']]+=1
    gaps=[{'image':r['image'],'artifactId':r['artifactId'],'type':r['type'],'name':r['name'],'version':r['version'],'locations':r['locations'],'reason':'No verified applicable package-owner declaration; metadata remains unresolved'} for r in queue if r['reviewStatus']=='licence-metadata-unresolved']
    summary={'schema':'stage74-package-context-review/v1','newPackageOwnerMetadataOccurrences':dict(added),'remainingMissingMetadata':len(gaps),'remainingByType':dict(sorted(collections.Counter(r['type'] for r in gaps).items())),'engineeringComplete':False,'engineeringBlockers':['Remaining applicable metadata gaps','Package-specific notices/source/build/relink delivery evidence incomplete'],'legalIdentityAndReview':'outside-this-engineering-scope','stage74Accepted':False,'productionDistributionCleared':False}
    return {n:(json.dumps(v,indent=2)+'\n').encode() for n,v in {'review-queue.json':queue,'gaps.json':gaps,'summary.json':summary,'inputs.json':{'previousQueueSha256':sha((BASE/'original-bsd-review/review-queue.json').read_bytes()),'contextSha256':sha((OUT/'context.json').read_bytes())}}.items()}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');a=p.parse_args();files=derive()
    for n,b in files.items():
        if a.verify:
            if (OUT/n).read_bytes()!=b:raise ValueError('Changed derived context: '+n)
        else:(OUT/n).write_bytes(b)
    print(files['summary.json'].decode())
if __name__=='__main__':main()
