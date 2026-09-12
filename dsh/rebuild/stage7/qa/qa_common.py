"""Stage7 guest-only verified TLS clients. Never print cookies or credentials."""
import json,socket,ssl,urllib.request,urllib.error
from pathlib import Path
from typing import Any
from qa_host import assert_qa_host
assert_qa_host()
import os
CELL=os.environ.get('DSH_STAGE7_QA_CELL','dsh2-stage7-qa3')
assert CELL=='dsh2-stage7-qa3'
OUT=Path('/var/lib/alica-stage7-'+CELL.rsplit('-',1)[-1]);ROOT=Path('/opt')/CELL
CORE='https://stage7.qa.invalid';APP='https://notebook.dsh.invalid'
_original=socket.getaddrinfo
def resolve(host,*a,**kw):
 if host not in ('stage7.qa.invalid','notebook.dsh.invalid'):raise RuntimeError('Fixture destination not approved')
 return _original('127.0.0.1' if host=='stage7.qa.invalid' else '10.84.0.10',*a,**kw)
socket.getaddrinfo=resolve
context=ssl.create_default_context(cafile=str(ROOT/'secrets/framework-ca.crt'))
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=context))
def http(base,path,method='GET',body=None,headers=None,raw=None) -> tuple[int, Any, dict[str, str]]:
 h={'Accept':'application/json',**(headers or {})}
 if body is not None:h['Content-Type']='application/json';raw=json.dumps(body,separators=(',',':')).encode()
 req=urllib.request.Request(base+path,data=raw,headers=h,method=method)
 try:r=client.open(req,timeout=30)
 except urllib.error.HTTPError as e:r=e
 with r:
  data=r.read(262145);assert len(data)<=262144
  try:data=json.loads(data)
  except (ValueError,UnicodeError):data=data.decode(errors='replace')
  assert isinstance(r.status,int)
  return r.status,data,dict(r.headers)
def owner(path,method='GET',body=None):
 import subprocess
 for attempt in range(2):
  cookies=json.loads((OUT/'browser-cookies.json').read_text());values={c['name']:c['value'] for c in cookies if c['domain']=='stage7.qa.invalid'}
  result=http(CORE,path,method,body,{'Cookie':'; '.join(k+'='+v for k,v in values.items()),'Origin':CORE,'X-CSRF-Token':values['aquiero_csrf']})
  if result[0]!=401 or attempt:return result
  # A browser login or normal expiry can retire the previous session. Renew
  # through real OIDC; never fabricate cookies or alter identity rows.
  subprocess.run(['python3','/srv/alica-stage7-qa/oidc.py'],check=True,stdout=subprocess.DEVNULL,timeout=60)
 raise RuntimeError('Owner authentication exhausted')
def backend(path,method='GET',body=None,key=None,token=None,extra=None):
 token=token or json.loads((OUT/'registration.json').read_text())['credential']['token']
 return http(CORE,path,method,body,{'Authorization':'Bearer '+token,**({'Idempotency-Key':key} if key else {}),**(extra or {})})
