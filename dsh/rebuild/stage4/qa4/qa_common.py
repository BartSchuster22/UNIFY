"""QA2-only verified TLS clients. Never print cookies or credentials."""
import json,socket,ssl,urllib.request,urllib.error
from pathlib import Path
OUT=Path('/srv/alica-dsh-development/stage4-tests/installed-qa4');ROOT=Path('/opt/dsh2-stage4-qa4')
CORE='https://stage4.dsh.invalid:19445';APP='https://notebook.dsh.invalid'
_original=socket.getaddrinfo
def resolve(host,*a,**kw):
 if host not in ('stage4.dsh.invalid','notebook.dsh.invalid'):raise RuntimeError('Fixture destination not approved')
 return _original('127.0.0.1' if host=='stage4.dsh.invalid' else '10.84.0.10',*a,**kw)
socket.getaddrinfo=resolve
context=ssl.create_default_context(cafile=str(ROOT/'secrets/framework-ca.crt'))
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a):return None
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=context))
def http(base,path,method='GET',body=None,headers=None,raw=None):
 h={'Accept':'application/json',**(headers or {})}
 if body is not None:h['Content-Type']='application/json';raw=json.dumps(body,separators=(',',':')).encode()
 req=urllib.request.Request(base+path,data=raw,headers=h,method=method)
 try:r=client.open(req,timeout=20)
 except urllib.error.HTTPError as e:r=e
 with r:
  data=r.read(262145);assert len(data)<=262144
  try:data=json.loads(data)
  except (ValueError,UnicodeError):data=data.decode(errors='replace')
  return r.status,data,dict(r.headers)
def owner(path,method='GET',body=None):
 cookies=json.loads((OUT/'browser-cookies.json').read_text());values={c['name']:c['value'] for c in cookies if c['domain']=='stage4.dsh.invalid'}
 return http(CORE,path,method,body,{'Cookie':'; '.join(k+'='+v for k,v in values.items()),'Origin':CORE,'X-CSRF-Token':values['aquiero_csrf']})
def backend(path,method='GET',body=None,key=None,token=None,extra=None):
 token=token or json.loads((OUT/'registration.json').read_text())['credential']['token']
 return http(CORE,path,method,body,{'Authorization':'Bearer '+token,**({'Idempotency-Key':key} if key else {}),**(extra or {})})
