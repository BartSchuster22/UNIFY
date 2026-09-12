"""Recover notice-file candidates from authenticated shipped OCI layers, without execution.
This is evidence collection, not legal determination or complete licence coverage.
"""
import gzip,hashlib,io,json,re,tarfile,zipfile
from pathlib import Path
from collect_current import B,RELEASE,require,sha
O=Path('/var/lib/alica-stage74-licensing/notices-run1')
LIMIT=2*1024*1024;ARCHIVE_LIMIT=64*1024*1024
PATTERN=re.compile(r'^(licen[cs]es?|copying|copyrights?|notices?|authors|third[-_ ]party[-_ ](?:licen[cs]es?|notices?))([._-].*)?$',re.I)
def candidate(name):
 p=Path(name)
 return bool(PATTERN.match(p.name)) or bool({'licenses','licences'} & {s.lower() for s in p.parts[:-1]})
def main():
 require(sha(B/'release.json')==RELEASE,'Release changed');r=json.loads((B/'release.json').read_text())
 O.mkdir(parents=True,mode=0o700,exist_ok=False);(O/'texts').mkdir(mode=0o700)
 rows=[];gaps=[];layers={};archives={};contents=set();visited=set()
 def store(data,where):
  if len(data)>LIMIT:gaps.append({**where,'reason':'notice-over-limit'});return
  if where['path'].lower().endswith('.gz'):
   try:
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as f:data=f.read(LIMIT+1)
   except (OSError,EOFError):gaps.append({**where,'reason':'invalid-gzip'});return
   if len(data)>LIMIT:gaps.append({**where,'reason':'expanded-notice-over-limit'});return
  digest=hashlib.sha256(data).hexdigest();dest=O/'texts'/digest
  if digest not in contents:dest.write_bytes(data);contents.add(digest)
  try:data.decode('utf-8');encoding='utf-8'
  except UnicodeDecodeError:encoding='non-utf8-unreviewed'
  rows.append({**where,'sha256':digest,'bytes':len(data),'encoding':encoding,'disposition':'notice-candidate-not-legally-reviewed'})
 for archive_name in ['images.tar','reference-image.tar']:
  archive=B/archive_name;require(sha(archive)==r['files'][archive_name],'Archive hash mismatch');archives[archive_name]=r['files'][archive_name]
  with tarfile.open(archive) as outer:
   manifest=json.load(outer.extractfile('manifest.json'));owners={}
   for image in manifest:
    ident='sha256:'+hashlib.sha256(outer.extractfile(image['Config']).read()).hexdigest()
    for layer in image['Layers']:owners.setdefault(layer,set()).add(ident)
   for layer,images in owners.items():
    blob=Path(layer).name;layer_digest='sha256:'+blob
    if blob in visited:
     layers[layer_digest]['images']=sorted(set(layers[layer_digest]['images'])|images);continue
    visited.add(blob);layers[layer_digest]={'images':sorted(images),'archive':archive_name,'blobPath':layer}
    # Authenticate each layer blob before parsing it.
    with outer.extractfile(layer) as f:
     h=hashlib.sha256()
     for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
    require(h.hexdigest()==blob,'Layer digest mismatch')
    with outer.extractfile(layer) as f,tarfile.open(fileobj=f,mode='r|*') as inner:
     for member in inner:
      where={'layer':layer_digest,'path':member.name}
      if candidate(member.name):
       if not member.isfile():gaps.append({**where,'reason':'nonregular-notice','linkTarget':member.linkname});continue
       if member.size>LIMIT:gaps.append({**where,'reason':'notice-over-limit'});continue
       store(inner.extractfile(member).read(),where)
      elif member.isfile() and member.name.lower().endswith(('.jar','.whl','.zip')):
       if member.size>ARCHIVE_LIMIT:gaps.append({**where,'reason':'nested-archive-over-limit'});continue
       data=inner.extractfile(member).read()
       try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
         for info in z.infolist():
          if info.is_dir() or not candidate(info.filename):continue
          location={**where,'path':member.name+'!/'+info.filename}
          if info.file_size>LIMIT:gaps.append({**location,'reason':'nested-notice-over-limit'});continue
          store(z.read(info),location)
       except (zipfile.BadZipFile,RuntimeError,NotImplementedError):gaps.append({**where,'reason':'unreadable-nested-archive'})
      elif member.isfile() and member.name.lower().endswith(('.tar','.tar.gz','.tgz','.crate','.tar.xz','.tar.bz2')):gaps.append({**where,'reason':'nested-nonzip-archive-not-inspected'})
 report={'schema':'stage74-layer-notice-discovery/v1','releaseSha256':RELEASE,'archives':archives,'layers':layers,'candidates':rows,'gaps':gaps,'uniqueContents':len(contents),'scope':'all shipped layers; filename candidates and bounded jar/whl/zip contents','limitations':['Filename matching does not prove complete notice coverage','Nonregular notice targets and nonzip nested archives remain unresolved','Licence texts, corresponding sources and rights require package-specific review','Deleted or replaced files in shipped layers are included, not just the runtime filesystem'],'legalCoverageComplete':False}
 (O/'notice-index.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'layers':len(layers),'noticeCandidates':len(rows),'uniqueContents':len(contents),'unresolvedExtractionItems':len(gaps),'legalCoverageComplete':False}),flush=True)
if __name__=='__main__':main()
