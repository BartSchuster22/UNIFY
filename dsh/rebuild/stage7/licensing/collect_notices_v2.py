"""Recover notice-file candidates from authenticated shipped OCI layers, without execution.
This is evidence collection, not legal determination or complete licence coverage.
"""
import gzip,hashlib,io,json,re,tarfile,zipfile,posixpath
from pathlib import Path
from collect_current import B,RELEASE,require,sha
O=Path('/var/lib/alica-stage74-licensing/notices-run3')
LIMIT=32*1024*1024;ARCHIVE_LIMIT=64*1024*1024
PATTERN=re.compile(r'^(licen[cs]es?|copying|copyrights?|notices?|authors|third[-_ ]party[-_ ](?:licen[cs]es?|notices?))([._-].*)?$',re.I)
def candidate(name):
 p=Path(name)
 return bool(PATTERN.match(p.name)) or bool({'licenses','licences','common-licenses'} & {s.lower() for s in p.parts[:-1]})
def main():
 require(sha(B/'release.json')==RELEASE,'Release changed');r=json.loads((B/'release.json').read_text())
 O.mkdir(parents=True,mode=0o700,exist_ok=False);(O/'texts').mkdir(mode=0o700)
 rows=[];gaps=[];layers={};archives={};contents=set();visited=set();references=[];image_layers={};whiteouts={};nested=[]
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
    image_layers[ident]=['sha256:'+Path(x).name for x in image['Layers']]
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
      if member.isdir():continue
      where={'layer':layer_digest,'path':member.name}
      if Path(member.name).name.startswith('.wh.'):
       whiteouts.setdefault(layer_digest,set()).add(member.name)
       continue
      if candidate(member.name):
       if not member.isfile():references.append({**where,'linkTarget':member.linkname,'hardlink':member.islnk()});continue
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
      elif member.isfile() and member.name.lower().endswith(('.tar','.tar.gz','.tgz','.crate','.tar.xz','.tar.bz2')):
       if member.size>ARCHIVE_LIMIT:gaps.append({**where,'reason':'nested-archive-over-limit'});continue
       data=inner.extractfile(member).read();count=0
       try:
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:*') as z:
         for info in z:
          if info.isfile() and candidate(info.name):
           location={**where,'path':member.name+'!/'+info.name}
           if info.size>LIMIT:gaps.append({**location,'reason':'nested-notice-over-limit'});continue
           store(z.extractfile(info).read(),location);count+=1
        nested.append({**where,'noticeCandidates':count})
       except (tarfile.TarError,OSError,EOFError):gaps.append({**where,'reason':'unreadable-nested-tar'})
 # Resolve notice references only inside authenticated image layers; never the host filesystem.
 def norm(path):
  result=posixpath.normpath(path).lstrip('/')
  return None if result=='..' or result.startswith('../') else result
 regular={(v['layer'],norm(v['path'])):v for v in rows if '!/' not in v['path']}
 links={(v['layer'],norm(v['path'])):v for v in references}
 def target(v):return norm(v['linkTarget'] if v['hardlink'] or v['linkTarget'].startswith('/') else posixpath.join(posixpath.dirname(v['path']),v['linkTarget']))
 def resolve(chain,path,at,seen):
  if path is None or len(seen)>32 or path in seen:return None
  seen=seen|{path}
  for j in range(at,-1,-1):
   layer=chain[j];key=(layer,path)
   if key in regular:return regular[key]
   if key in links:return resolve(chain,target(links[key]),j if links[key]['hardlink'] else at,seen)
   parts=path.split('/')
   deletions={posixpath.join(*parts[:k],'.wh.'+parts[k]) for k in range(len(parts))}
   opaque={posixpath.join(*parts[:k],'.wh..wh..opq') for k in range(len(parts))}
   if (deletions|opaque)&whiteouts.get(layer,set()):return None
  return None
 resolved=[]
 for v in references:
  for image in layers[v['layer']]['images']:
   chain=image_layers[image];found=resolve(chain,target(v),chain.index(v['layer']),{norm(v['path'])})
   if found:resolved.append({**v,'imageId':image,'targetLayer':found['layer'],'targetPath':found['path'],'sha256':found['sha256']})
   else:gaps.append({**v,'imageId':image,'reason':'unresolved-reference-at-link-layer'})
 report={'schema':'stage74-layer-notice-discovery/v1','releaseSha256':RELEASE,'archives':archives,'layers':layers,'candidates':rows,'gaps':gaps,'imageLayers':image_layers,'resolvedReferences':resolved,'nestedTarInspections':nested,'uniqueContents':len(contents),'scope':'all shipped layers; filename candidates, bounded jar/whl/zip/tar contents, and image-local reference resolution','limitations':['Filename matching does not prove complete notice coverage','Unresolved image-local references and unreadable archives remain explicit gaps','Licence texts, corresponding sources and rights require package-specific review','Deleted or replaced files in shipped layers are included, not just the runtime filesystem'],'legalCoverageComplete':False}
 (O/'notice-index.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'layers':len(layers),'noticeCandidates':len(rows),'uniqueContents':len(contents),'resolvedReferences':len(resolved),'unresolvedExtractionItems':len(gaps),'legalCoverageComplete':False}),flush=True)
if __name__=='__main__':main()
