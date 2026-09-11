"""Export an existing owner session to a private browser transfer file, never stdout."""
import json,os,socket
from pathlib import Path
assert os.geteuid()==0 and socket.gethostname()=='DSH2'
p=Path('/home/deploy/.stage6-private-browser');p.mkdir(mode=0o700,exist_ok=True);os.chown(p,1000,1000)
rows=json.loads(Path('/var/lib/alica-stage5-qa5/browser-cookies.json').read_text());cookies=[]
for c in rows:
 rest=c.get('_rest',{});v={k:c[k] for k in ('name','value','domain','path','secure')};v['httpOnly']='HttpOnly' in rest;v['sameSite']=rest.get('SameSite','Lax').capitalize()
 if c.get('expires') is not None:v['expires']=c['expires']
 cookies.append(v)
p=p/'cookies.json';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as f:json.dump(cookies,f)
os.chmod(p,0o600);os.chown(p,1000,1000)
print('Private owner-session export prepared; no values emitted')
