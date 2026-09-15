#!/usr/bin/env python3
"""Remove only byte-verified disposable upload fixtures and the matching QA identity."""
import importlib.util,json,os,subprocess,sys
from pathlib import Path
HOME=Path('/home/herman/.config/dsh-maintenance-recovery')
s=importlib.util.spec_from_file_location('prepare',Path(__file__).with_name('prepare-dsh-maintenance.py'));assert s and s.loader
P=importlib.util.module_from_spec(s);s.loader.exec_module(P)
INNER=r'''import json,sys,re,hashlib,shutil
from pathlib import Path
q=json.load(sys.stdin);assert re.fullmatch(r'qa-maintenance-[a-f0-9]{32}',q['username'])
p=Path(q['directory']);assert p==Path('/opt/data/workspace')/q['username'];assert p.is_dir() and not any(x.is_symlink() for x in [p,*p.parents])
items=list(p.rglob('*'));assert len(items)==4 and not any(x.is_symlink() for x in items)
files=[x for x in items if x.is_file()];assert len(files)==3 and [x for x in items if x.is_dir()]==[p/'.dsh-file-versions']
expected={'qa-large.bin':b'A'*(1200*1024),'qa-note.txt':b'Disposable confirmed replacement.\n'}
for name,body in expected.items():assert hashlib.sha256((p/name).read_bytes()).digest()==hashlib.sha256(body).digest()
retained=[x for x in files if x.parent==p/'.dsh-file-versions'];assert len(retained)==1 and retained[0].read_bytes()==b'Disposable upload test. Not knowledge.\n'
shutil.rmtree(p);assert not p.exists();print(json.dumps({'removedQAWorkspace':str(p),'currentAndRetainedFixtureBytesVerified':True}))
'''
CODE='import subprocess,sys\np=subprocess.run(["docker","exec","-i","dsh2-internal-onboarding1-hermes-1","python3","-c",'+repr(INNER)+'],input=sys.stdin.read(),text=True,capture_output=True);sys.stdout.write(p.stdout);sys.stderr.write(p.stderr);sys.exit(p.returncode)'
def main():
 os.umask(0o077);q=json.loads((HOME/'qa-browser.json').read_text());resource=json.loads((HOME/'qa-workspace-resource.json').read_text());receipt=json.loads((HOME/'live-browser-receipt.json').read_text());assert receipt['disposableCoreSessionRevoked']
 cleaned=json.loads(P.remote('dsh',CODE,json.dumps({'username':q['username'],'directory':resource['directory']})))
 (HOME/'qa-cleanup-receipt.json').write_text(json.dumps(cleaned,indent=2))
 subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('dsh-maintenance-qa-identity.py')),'delete'],check=True)
 for name in ['qa-browser-storage.json','qa-workspace-resource.json']:(HOME/name).unlink()
 assert not (HOME/'qa-browser.json').exists();cleaned.update(identityDeleted=True,localBrowserCredentialsRemoved=True)
 (HOME/'qa-cleanup-receipt.json').write_text(json.dumps(cleaned,indent=2));print(json.dumps(cleaned))
if __name__=='__main__':main()
