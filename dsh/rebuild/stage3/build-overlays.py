#!/usr/bin/env python3
"""Build-time Stage3 overlays from the pinned public Stage2 images; no target lifecycle writes."""
import argparse, hashlib, json, pathlib, shutil, subprocess, tempfile
BASES={'hermes':'sha256:6dcfb52a1fdf81191ea2b9aba036c2127c0b3ba2837281c1c491d9640998aedc','unify-core':'sha256:bae048ece0100b51f15a9f7dd1d29968debfba7cc410f9d0d32ca329ed6e2a14','memory-v4':'sha256:f75f26f19fde22e85826d0657e7a23546af85f76cf9a9e7cbc072e202c4c9c82'}
def run(*args,cwd=None):return subprocess.check_output(args,cwd=cwd,text=True).strip()
def main():
 p=argparse.ArgumentParser();p.add_argument('--unify',type=pathlib.Path,required=True);p.add_argument('--memory',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--revision',required=True);a=p.parse_args()
 assert len(a.revision)<=80 and all(c.isalnum() or c in '.-' for c in a.revision)
 assert not a.output.exists(),'Use a new build output directory';a.output.mkdir(parents=True)
 assert shutil.disk_usage(a.output).free>3*1024**3,'Build requires 3 GiB free'
 result={}
 for service,base in BASES.items():
  meta=json.loads(run('sudo','-n','docker','image','inspect',base))[0];assert meta['Id']==base
  # Dedicated local tag points at a verified immutable config digest; BuildKit local
  # resolution reuses the image shipped in the public Stage2 offline artifact.
  basetag='alica-dsh-stage3-base/'+service+':'+base.split(':')[1][:16]
  run('sudo','-n','docker','tag',base,basetag)
  context=a.output/service;context.mkdir()
  if service=='hermes':
   shutil.copytree(a.unify/'apps/hermes-control-adapter/dist',context/'dist')
   shutil.copy2(a.unify/'integrations/hermes/application-runtime/worker.py',context/'worker.py')
   additions='COPY --chown=10000:10001 dist /opt/unify-adapter/dist\nCOPY --chown=10000:10001 worker.py /opt/unify-adapter/application-runtime/worker.py\n'
  elif service=='unify-core':
   shutil.copytree(a.unify/'apps/gateway/dist',context/'dist');shutil.copytree(a.unify/'apps/gateway/migrations',context/'migrations')
   additions='COPY --chown=65532:65532 dist /app/dist\nCOPY --chown=65532:65532 migrations /app/migrations\n'
  else:
   shutil.copytree(a.memory/'app',context/'app',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
   additions='COPY --chown=65532:65532 app /app/app\n'
  (context/'Dockerfile').write_text('FROM '+basetag+'\n'+additions+'LABEL com.alica.stage3.source="'+a.revision+'"\n')
  tag='alica-dsh-stage3/'+service+':'+a.revision
  process=subprocess.run(['sudo','-n','docker','build','--network=none','--pull=false','--tag',tag,str(context)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
  (context/'build.log').write_text(process.stdout);process.check_returncode()
  image=json.loads(run('sudo','-n','docker','image','inspect',tag))[0]
  result[service]={'id':image['Id'],'reference':tag,'base':base,'architecture':image['Architecture'],'os':image['Os'],'sourceSnapshot':a.revision,'files':{str(f.relative_to(context)):hashlib.sha256(f.read_bytes()).hexdigest() for f in context.rglob('*') if f.is_file() and f.name!='build.log'}}
 (a.output/'images.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v['id'] for k,v in result.items()}))
if __name__=='__main__':main()
