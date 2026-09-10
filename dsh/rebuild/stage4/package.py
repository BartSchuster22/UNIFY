#!/usr/bin/env python3
"""Produce a Stage4 development candidate using the unchanged Stage2 lifecycle protocol.
No target repository checkout, editable provider selection or lifecycle bypass is needed.
"""
import argparse,gzip,hashlib,json,pathlib,shutil,subprocess,tarfile

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 return h.hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--stage2-bundle',type=pathlib.Path,required=True);p.add_argument('--stage2-sha256',required=True);p.add_argument('--overlays',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--revision',required=True);a=p.parse_args()
 assert sha(a.stage2_bundle/'release.json')==a.stage2_sha256,'Stage2 trust anchor mismatch'
 release=json.loads((a.stage2_bundle/'release.json').read_text());assert release['schema']=='dsh-stage2-bundle/v1'
 for name,expected in release['files'].items():assert sha(a.stage2_bundle/name)==expected,'Stage2 artifact modified: '+name
 assert not a.output.exists(),'Output must be new';assert shutil.disk_usage(a.output.parent).free>6*1024**3,'Need 6 GiB for candidate artifact'
 a.output.mkdir();images=json.loads(a.overlays.read_text());assert set(images)=={'hermes','unify-core','memory-v4'}
 for name in release['files']:
  if name!='images.tar':shutil.copy2(a.stage2_bundle/name,a.output/name)
 compose=json.loads((a.output/'compose.template.json').read_text());services=compose['services']
 services['unify-core']['environment']['APPLICATION_INTEGRATION_ENABLED']='true'
 services['hermes']['environment'].update(HERMES_APPLICATION_WORKER_FILE='/opt/unify-adapter/application-runtime/worker.py',HERMES_APPLICATION_PYTHON='/opt/hermes/.venv/bin/python',PYTHONPATH='/opt/hermes')
 networks=services['hermes']['networks']
 if 'application' not in networks:
  if isinstance(networks,dict):networks['application']=None
  else:networks.append('application')
 for service in services.values():service['labels']['com.alica.application-contract']='alica-application/v1'
 (a.output/'compose.template.json').write_text(json.dumps(compose,indent=2)+'\n')
 for service,item in images.items():
  meta=json.loads(subprocess.check_output(['sudo','-n','docker','image','inspect',item['reference']],text=True))[0]
  assert meta['Id']==item['id'] and meta['Architecture']=='amd64' and meta['Os']=='linux'
  release['images'][service]={'reference':item['reference'],'id':meta['Id'],'size_bytes':meta['Size'],'architecture':meta['Architecture'],'os':meta['Os'],'base_image_id':item['base'],'filesystem_diff_ids':meta['RootFS']['Layers']}
  # Native update visibility remains an immutable OCI descriptor where Docker
  # exposes it. Never pretend a config digest is a registry manifest digest.
  desc=(meta.get('Descriptor') or {}).get('digest')
  if desc:release['images'][service]['oci_reference']=item['reference'].rsplit(':',1)[0]+'@'+desc
 with (a.output/'images.tar').open('wb') as f:
  process=subprocess.Popen(['sudo','-n','docker','save',*[x['reference'] for x in release['images'].values()]],stdout=subprocess.PIPE)
  with gzip.GzipFile(fileobj=f,mode='wb',compresslevel=1,mtime=0) as zipped:shutil.copyfileobj(process.stdout,zipped,8*1024*1024)
  assert process.wait()==0,'Docker archive export failed'
 # Docker's classic store omits Descriptor. Build an actual offline OCI manifest
 # from verified config/layer bytes in the distributable archive, never from a
 # config ID masquerading as a manifest digest. This asserts no registry availability.
 extra=[]
 with tarfile.open(a.output/'images.tar') as archive:
  manifest=json.load(archive.extractfile('manifest.json'))
  for service,item in images.items():
   entry=next(m for m in manifest if item['reference'] in (m.get('RepoTags') or []))
   def descriptor(name,media):
    h=hashlib.sha256();f=archive.extractfile(name)
    for block in iter(lambda:f.read(8*1024*1024),b''):h.update(block)
    return {'mediaType':media,'digest':'sha256:'+h.hexdigest(),'size':archive.getmember(name).size}
   config=descriptor(entry['Config'],'application/vnd.oci.image.config.v1+json')
   assert config['digest']==item['id'],'Archive config does not match pinned image'
   layers=[descriptor(n,'application/vnd.oci.image.layer.v1.tar') for n in entry['Layers']]
   assert [l['digest'] for l in layers]==release['images'][service]['filesystem_diff_ids']
   document={'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json','config':config,'layers':layers}
   name=service+'.oci-manifest.json';(a.output/name).write_text(json.dumps(document,separators=(',',':')))
   extra.append(name);release['images'][service]['oci_reference']=item['reference'].rsplit(':',1)[0]+'@sha256:'+sha(a.output/name)
   release['images'][service]['oci_distribution']='offline manifest; blobs in images.tar; registry availability not asserted'
 release['release']='dsh-stage4-candidate-'+a.revision
 release['workflow_contract']='alica-native-recurring/v1'
 release['application_contract']='alica-application/v1';release['lifecycle_protocol']='unchanged dsh-stage2-bundle/v1'
 release['acceptance']='DEVELOPMENT CANDIDATE; live installed-stack acceptance not established by build'
 release['base_stage2_release_sha256']=a.stage2_sha256;release['source_revisions']['application_bridge']=a.revision
 release['files']={name:sha(a.output/name) for name in [*release['files'],*extra]}
 (a.output/'release.json').write_text(json.dumps(release,indent=2)+'\n');(a.output/'release.sha256').write_text(sha(a.output/'release.json')+'  release.json\n')
 print(json.dumps({'bundle':str(a.output),'release_sha256':sha(a.output/'release.json'),'status':'development-candidate','images':{n:m['id'] for n,m in release['images'].items()}}))
if __name__=='__main__':main()
