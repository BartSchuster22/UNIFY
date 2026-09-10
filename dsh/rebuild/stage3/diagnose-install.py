#!/usr/bin/env python3
"""Run the same lifecycle driver with secret-redacted failed-command diagnostics."""
import json,re,subprocess,sys,hashlib
from pathlib import Path
b=Path('/srv/alica-dsh-development/stage3-package-qa1');sys.path.insert(0,str(b));import install
root=Path('/opt/dsh2-stage3-qa1');secrets=[]
for p in (root/'secrets').iterdir():
 if p.is_file():
  s=p.read_text().strip()
  if 10<len(s)<400:secrets.append(s)
original=subprocess.run
def run(*a,**kw):
 result=original(*a,**kw)
 if result.returncode:
  text=str(result.stdout or '')+'\n'+str(result.stderr or '')
  for s in secrets:text=text.replace(s,'[REDACTED]')
  text=re.sub(r'postgres(?:ql)?://[^\s]+','[DATABASE URL]',text)
  text=re.sub(r'\b[a-f0-9]{72}\b','[SECRET]',text)
  print('FAILED COMMAND DIAGNOSTIC: '+text[-5000:],flush=True)
 return result
subprocess.run=run
r=json.loads(Path('/srv/alica-dsh-development/stage3-tests/installed-qa1/request.json').read_text())
i=install.Installer(b,hashlib.sha256((b/'release.json').read_bytes()).hexdigest(),root,r)
print(json.dumps(i.install()))
