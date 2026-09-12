import http.cookiejar,json,os,secrets,socket,ssl,sys,urllib.request,urllib.parse,urllib.error
recovery_mode="--recovered-owner" in sys.argv
from html.parser import HTMLParser
from pathlib import Path
cell=os.environ.get('DSH_STAGE7_QA_CELL','dsh2-stage7-qa3')
assert cell=='dsh2-stage7-qa3'
from qa_host import assert_qa_host
assert_qa_host()
root=Path('/opt')/cell;out=Path('/var/lib/alica-stage7-'+cell.rsplit('-',1)[-1])
request=json.loads((root/'operations/request.json').read_text())
origin=request['origin'];host=urllib.parse.urlsplit(origin).hostname;owner=request['owner']
assert host=='stage7.qa.invalid'
original=socket.getaddrinfo
def resolve(name,*args,**kwargs):
 if name!=host:raise RuntimeError('Unexpected network destination')
 return original('127.0.0.1',*args,**kwargs)
socket.getaddrinfo=resolve
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  if not newurl.startswith(origin+'/'):raise RuntimeError('Unexpected authentication redirect')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
jar=http.cookiejar.CookieJar();ctx=ssl.create_default_context(cafile=str(root/'secrets/framework-ca.crt'));assert ctx.check_hostname and ctx.verify_mode==ssl.CERT_REQUIRED
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=ctx),Redirect(),urllib.request.HTTPCookieProcessor(jar))
class Forms(HTMLParser):
 def __init__(self):super().__init__();self.forms=[];self.current=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='form':self.current={'action':a.get('action',''),'fields':{},'names':[]};self.forms.append(self.current)
  if tag=='input' and self.current is not None and a.get('name'):
   self.current['names'].append(a['name'])
   if a.get('type')=='hidden':self.current['fields'][a['name']]=a.get('value','')
 def handle_endtag(self,tag):
  if tag=='form':self.current=None
checks={}
report={}
os.umask(0o077)
out.mkdir(parents=True,mode=0o700,exist_ok=True)
def fetch(path,body=None):
 url=path if path.startswith('https:') else origin+path
 if not url.startswith(origin+'/'):raise RuntimeError('Unexpected URL')
 headers={'Origin':origin}
 if body is not None:headers['Content-Type']='application/x-www-form-urlencoded';body=urllib.parse.urlencode(body).encode()
 try:r=opener.open(urllib.request.Request(url,data=body,headers=headers),timeout=20)
 except urllib.error.HTTPError as e:r=e
 data=r.read().decode();return r.status,data,r.geturl()
def form(text,field):
 parser=Forms();parser.feed(text)
 matches=[f for f in parser.forms if field in f['names']]
 if len(matches)!=1:raise RuntimeError('Expected identity form missing; available field names: '+str([f['names'] for f in parser.forms]))
 return matches[0]

def pick(body,field):
 parsed=Forms();parsed.feed(body)
 choices=[f for f in parsed.forms if field in f['names']]
 if len(choices)!=1:raise RuntimeError('Expected identity form: '+field)
 return choices[0]
def submit(form,fields,url):
 data={**form['fields'],**fields}
 return fetch(urllib.parse.urljoin(url,form['action']),data)

status,data,_=fetch('/api/v1/auth/method');assert json.loads(data)['method']=='oidc'
status,body,url=fetch('/api/v1/auth/oidc/login')
form=pick(body,'password');status,body,url=submit(form,{'username':owner,'password':(out/'test-owner-password').read_text().strip() if recovery_mode else 'deliberately-wrong-fixture-password'},url)
assert fetch('/api/v1/auth/me')[0]==401
report['wrong_password_denied']=True
if recovery_mode:report['former_owner_password_denied_after_recovery']=True
form=pick(body,'password');status,body,url=submit(form,{'username':owner,'password':((root/'secrets/recovered-owner-password') if recovery_mode else ((out/'test-owner-password') if (out/'test-owner-password').exists() else (root/'secrets/owner-password'))).read_text().strip()},url)
if recovery_mode or not (out/'test-owner-password').exists():
 form=pick(body,'password-new');new=secrets.token_urlsafe(40);(out/'test-owner-password').write_text(new)
 status,body,url=submit(form,{'password-new':new,'password-confirm':new},url);report['mandatory_password_change']=status==200
forms=Forms();forms.feed(body)
if any('email' in f['names'] for f in forms.forms):
 form=pick(body,'email');status,body,url=submit(form,{'email':'owner@stage2.invalid','firstName':'DSH','lastName':'Owner'},url)
status,body,_=fetch('/api/v1/auth/me');assert status==200
report['real_core_identity_session']=True
for path in ['/api/v1/frameworks/hermes-alica/providers','/api/v1/frameworks/hermes-alica/models']:
 assert fetch(path)[0]==200
report['native_inventory_through_identity_session']=True
(out/'browser-cookies.json').write_text(json.dumps([c.__dict__ for c in jar]));(out/'oidc-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
