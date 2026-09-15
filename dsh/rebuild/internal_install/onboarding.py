"""Operator-local onboarding. No password in JSON, argv, or ordinary stdout.
The bootstrap authenticates the bundle before calling this module.
"""
import json,os,re,stat,subprocess,sys
from pathlib import Path
from setup import Denied,require,secure,read_state

# Run only in the validated owning Keycloak network namespace. Reads identity
# state through its supported admin API; never edits identity or application DBs.
STATUS_CODE = r'''
import json,sys,urllib.parse,urllib.request
from pathlib import Path
root,owner=sys.argv[1:]
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def req(path,body=None,token=None):
 headers={}
 if token:headers['Authorization']='Bearer '+token
 if body is not None:
  headers['Content-Type']='application/x-www-form-urlencoded';body=urllib.parse.urlencode(body).encode()
 with opener.open(urllib.request.Request('http://127.0.0.1:8080/identity/'+path,data=body,headers=headers),timeout=10) as response:
  data=response.read(65537)
  if len(data)>65536:raise ValueError('Oversized identity response')
  return json.loads(data)
auth=req('realms/master/protocol/openid-connect/token',{'grant_type':'password','client_id':'admin-cli','username':'recovery-admin','password':(Path(root)/'secrets/keycloak-admin-password').read_text().strip()})
users=req('admin/realms/alica/users?'+urllib.parse.urlencode({'username':owner,'exact':'true'}),token=auth['access_token'])
if len(users)!=1 or users[0]['username']!=owner:raise ValueError('Unique owner missing')
u=users[0]
print(json.dumps({'enabled':u['enabled'],'temporaryPasswordRequired':'UPDATE_PASSWORD' in u.get('requiredActions',[]),'requiredActions':u.get('requiredActions',[])}))
'''

def inspect_owner(bundle,pin,root,request_path):
 require(os.geteuid()==0,'Root operator required')
 bundle=secure(bundle);root=secure(root);request_path=secure(request_path)
 r=json.loads(request_path.read_text());sys.path.insert(0,str(bundle))
 from install import Installer
 i=Installer(str(bundle),pin,str(root),r)
 require(i.tx.inspect()['state']!='absent','Installation does not exist')
 with i.tx.locked():
  candidates=[c for c in i.owned() if c['Config']['Labels'].get('com.alica.component')=='keycloak' and c['State']['Running']]
  require(len(candidates)==1,'Running owned identity service required')
  secure(root/'secrets/keycloak-admin-password')
  result=subprocess.run(['nsenter','--target',str(candidates[0]['State']['Pid']),'--net','python3','-c',STATUS_CODE,str(root),r['owner']],capture_output=True,text=True,timeout=40)
  require(result.returncode==0,'Cannot verify owner identity state; no password disclosed')
  status=json.loads(result.stdout)
 require(status['enabled'],'Owner account is disabled; resolve identity status before onboarding')
 return r,status

def initial_available(root,status):
 # A failed or previous recovery can leave a file whose credential was never
 # activated. Never infer its validity from file existence or reveal it here.
 return status['temporaryPasswordRequired'] and not (Path(root)/'secrets/recovered-owner-password').exists() and not (Path(root)/'onboarding-initial-claimed.json').exists()

def claim_initial(root):
 # Claim before disclosure: repeated retrieval or terminal failure requires
 # explicit recovery, never replay of an old initial credential after expiry.
 p=Path(root)/'onboarding-initial-claimed.json'
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:
  f.write('{"initialHandoffClaimed":true}\n');f.flush();os.fsync(f.fileno())
 directory=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(directory)
 finally:os.close(directory)

def require_terminal():
 require(sys.stdin.isatty() and sys.stdout.isatty(),'Password access requires an interactive terminal; no pipe, redirection or routine log output')

def confirm(word):
 require_terminal()
 # A terminal is non-seekable: buffered text update mode (r+) is invalid.
 with open('/dev/tty','w') as output, open('/dev/tty','r') as input_tty:
  output.write('Disable terminal recording. Type '+word+' to proceed, or Enter to cancel: ');output.flush()
  require(input_tty.readline().strip()==word,'Cancelled; credentials unchanged')

def reveal(path):
 require_terminal();p=secure(path);s=p.stat()
 require(stat.S_ISREG(s.st_mode) and not s.st_mode & 0o077 and s.st_nlink==1,'Private regular single-link credential file required')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd) as f:
  require(os.fstat(f.fileno()).st_ino==s.st_ino,'Credential changed during access')
  value=f.read(4097).strip()
 require(re.fullmatch(r'[A-Za-z0-9_-]{20,128}',value) is not None,'Invalid generated credential file')
 with open('/dev/tty','w') as tty:
  tty.write('\nTemporary owner password: '+value+'\nChange it at first sign-in. It is NOT a permanent password.\n');tty.flush()

def run(a):
 require(os.geteuid()==0,'Root operator required')
 destination,state,verified=read_state(a.destination)
 bundle=destination/'bundle';request_path=destination/'request.json';root=secure(a.root)
 r,status=inspect_owner(bundle,verified['releaseSha256'],root,request_path)
 result={'signInUrl':r['origin'],'username':r['owner'],'identityStatus':status,
         'initialPasswordAvailable':initial_available(root,status),
         'instructions':'Sign in, replace the temporary password if prompted, complete your own profile, then authorize your provider. Do not send passwords or tokens to support.',
         'onboardingAccepted':False}
 if a.action=='onboarding':
  if a.reveal_initial_password:
   require(result['initialPasswordAvailable'],'Initial password is no longer safely deliverable. Use your chosen password or explicit recover-owner; do not reuse the original file')
   confirm('REVEAL');claim_initial(root);reveal(root/'secrets/owner-password')
   result['initialPasswordAvailable']=False
   result['initialHandoffClaimed']=True
  return result
 require(a.action=='recover-owner','Unknown onboarding action')
 confirm('RESET '+r['owner'])
 command=[str(bundle/'alicactl'),'recover-owner','--bundle',str(bundle),'--release-sha256',verified['releaseSha256'],'--root',str(root),'--request',str(request_path)]
 completed=subprocess.run(command,capture_output=True,text=True,timeout=90)
 require(completed.returncode==0,'Recovery failed; any recovery file may NOT be active. No password disclosed. Preserve diagnostics and retry explicit recovery')
 receipt=json.loads(completed.stdout)
 target=root/'secrets/recovered-owner-password'
 require(receipt.get('owner_recovery') is True and receipt.get('existing_identity_sessions_revoked') is True and receipt.get('temporary_password_file')==str(target),'Recovery receipt not accepted; no password disclosed')
 _,after=inspect_owner(bundle,verified['releaseSha256'],root,request_path)
 require(after['temporaryPasswordRequired'],'Temporary password state not confirmed; no password disclosed')
 reveal(target)
 return {**result,'identityStatus':after,'initialPasswordAvailable':False,'ownerRecovery':True,'existingIdentitySessionsRevoked':True}
