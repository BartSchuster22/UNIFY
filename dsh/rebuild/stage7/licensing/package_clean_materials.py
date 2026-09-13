"""Package verified source materials and actual retained licence documents.
This supplies bytes, not an assertion of complete source/build/relink compliance.
"""
import hashlib,io,json,os,posixpath,re,socket,tarfile,urllib.parse
from pathlib import Path
import build_clean_candidate as b
B=Path('/srv/alica-stage74-clean-candidate1')
DOC=re.compile(r'(?i)^(licen[cs]e|copying|copyright|notice|authors)([._-].*)?$')
def json_bytes(value):return (json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
def add(t,name,data):
    m=tarfile.TarInfo(name);m.size=len(data);m.mode=0o644;t.addfile(m,io.BytesIO(data))
def source_files(report,root):
    files={};seen=set()
    for row in report['results']:
        key=(row['name'],row['version'])
        if key in seen or row['status']!='exact-dsc-source-materials-collected':raise ValueError('Incomplete or duplicate source set')
        seen.add(key);folder=row['name']+'_'+urllib.parse.quote(row['version'],safe='')
        for item in [row['dsc'],*row['materials']]:
            name=item['name']
            if Path(name).name!=name or name in ('.','..'):raise ValueError('Unsafe source filename')
            p=root/folder/name
            if p.is_symlink() or b.sha(p)!=item['sha256']:raise ValueError('Changed source material')
            if 'bytes' in item and p.stat().st_size!=item['bytes']:raise ValueError('Changed source size')
            files[folder+'/'+name]=p
    return files

def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong packaging host')
    original=b.canonical_snapshot(json.loads((B/'original-containers.private.json').read_bytes()))
    if b.container_snapshot()!=original:raise ValueError('QA changed')
    out=B/'materials';out.mkdir(mode=0o700,exist_ok=False)
    sr=B/'debian-sources/report.json';report=json.loads(sr.read_bytes())
    if report['scanReceiptSha256']!=b.sha(B/'scans/receipt.json'):raise ValueError('Wrong source inventory')
    sources=source_files(report,B/'debian-sources')
    index={name:{'sha256':b.sha(p),'bytes':p.stat().st_size} for name,p in sorted(sources.items())}
    with tarfile.open(out/'debian-source-materials.tar','w') as t:
        add(t,'MANIFEST.json',json_bytes(index));add(t,'SOURCE-REPORT.json',sr.read_bytes())
        for name,p in sorted(sources.items()):
            m=tarfile.TarInfo('sources/'+name);m.size=p.stat().st_size;m.mode=0o644
            with p.open('rb') as f:t.addfile(m,f)
    docs=[];objects={};build=json.loads((B/'build-receipt.json').read_bytes())
    for role,image in build['images'].items():
        tr=json.loads((B/role/'transformation.json').read_bytes())
        if b.sha(B/role/'transformation.json')!=image['transformationSha256'] or b.sha(B/role/'clean-layer.tar')!=tr['cleanLayerSha256']:raise ValueError('Changed clean layer')
        with tarfile.open(B/role/'clean-layer.tar') as t:
            members={b.norm(m.name):m for m in t.getmembers()}
            for name,m in members.items():
                if not DOC.fullmatch(posixpath.basename(name)):continue
                target=name;seen=set()
                while m.issym():
                    if target in seen:raise ValueError('Licence symlink cycle')
                    seen.add(target);target=posixpath.normpath(m.linkname.lstrip('/') if m.linkname.startswith('/') else posixpath.join(posixpath.dirname(target),m.linkname));m=members.get(target)
                    if m is None:break
                if m is None or not m.isfile() or m.size>4*1024*1024:continue
                f=t.extractfile(m)
                if f is None:raise ValueError('Unreadable licence member')
                data=f.read()
                try:data.decode('utf-8')
                except UnicodeDecodeError:continue
                h=hashlib.sha256(data).hexdigest();objects[h]=data;docs.append({'image':role,'imageId':image['imageId'],'path':name,'resolvedPath':target,'sha256':h,'bytes':len(data)})
    with tarfile.open(out/'retained-notice-documents.tar','w') as t:
        add(t,'documents.json',json_bytes(docs))
        for h,data in sorted(objects.items()):add(t,'texts/'+h+'.txt',data)
    b.js(out/'retained-documents.json',docs)
    if b.container_snapshot()!=original:raise ValueError('Original QA changed during packaging')
    result={'schema':'stage74-clean-material-delivery/v1','buildReceiptSha256':b.sha(B/'build-receipt.json'),'sourceReportSha256':b.sha(sr),'sourcePackages':len(report['results']),'sourceFiles':len(sources),'retainedNoticeOccurrences':len(docs),'uniqueRetainedNoticeDocuments':len(objects),'archives':{n:{'sha256':b.sha(out/n),'bytes':(out/n).stat().st_size} for n in ['debian-source-materials.tar','retained-notice-documents.tar']},'retainedDocumentIndexSha256':b.sha(out/'retained-documents.json'),'originalQAUnchanged':True,'engineeringComplete':False,'sourceBuildRelinkDisposition':'not-implied-by-material-collection'}
    b.js(out/'receipt.json',result);print(json.dumps(result),flush=True)
if __name__=='__main__':main()
