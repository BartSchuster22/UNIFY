"""Detached Ed25519 release authentication. Never imports or executes bundle code.

QA trust is explicitly separate from production trust. This is an admission
primitive, not an updater: a valid signature is NOT schema/rollback evidence.
"""
import argparse,base64,hashlib,json,os,re,stat,time
from pathlib import Path,PurePosixPath
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey,Ed25519PublicKey

DOMAIN=b'ALICA-RELEASE-ENVELOPE-V1\x00'
class Denied(ValueError):pass

def require(ok,message):
 if not ok:raise Denied(message)
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
def unique(pairs):
 d={}
 for k,v in pairs:
  require(k not in d,'Duplicate JSON key');d[k]=v
 return d
def load(path):
 raw=Path(path).read_bytes();require(len(raw)<=32*1024**2,'Oversized metadata')
 return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda s:(_ for _ in ()).throw(Denied('Nonfinite JSON')))
def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def sha(value):require(isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value),'Invalid SHA-256')
def safe_name(value):
 require(isinstance(value,str) and value and not value.startswith('/'),'Unsafe artifact path')
 require(all(p not in ('','..','.') for p in value.split('/')),'Unsafe artifact path')
 require(str(PurePosixPath(value))==value,'Noncanonical artifact path')
def inventory(root):
 root=Path(root);require(root.is_dir() and not root.is_symlink(),'Invalid bundle root');result={}
 for p in sorted(root.rglob('*')):
  mode=p.lstat().st_mode;require(not stat.S_ISLNK(mode),'Symlink in bundle')
  if stat.S_ISDIR(mode):continue
  require(stat.S_ISREG(mode),'Special file in bundle');n=p.relative_to(root).as_posix();safe_name(n);result[n]=digest(p)
 require('release.json' in result and len(result)<=100000,'Invalid release inventory')
 return result

def secure_parent(path):
 p=Path(path).absolute()
 for parent in p.parents:
  s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid in (0,os.geteuid()) and not stat.S_IMODE(s.st_mode)&0o022,'Unsafe trust/key parent')
def owned(path,secret=False):
 p=Path(path);s=p.lstat();require(stat.S_ISREG(s.st_mode) and s.st_uid in (0,os.geteuid()),'Untrusted owner/type')
 require(not stat.S_IMODE(s.st_mode)&(0o077 if secret else 0o022),'Unsafe trust/key permissions')
 secure_parent(p)
 return p

def key_id(public):return hashlib.sha256(public).hexdigest()
def write_new(path,data,mode):
 p=Path(path);fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
def keygen(private,trust,scope):
 require(scope in ('qa','production'),'Invalid scope');require(not Path(private).exists() and not Path(trust).exists(),'Key/trust already exists')
 secure_parent(private);secure_parent(trust)
 key=Ed25519PrivateKey.generate();public=key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw);kid=key_id(public)
 write_new(private,key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()),0o600)
 value={'schema':'alica-release-trust/v1','scope':scope,'keys':{kid:base64.b64encode(public).decode()},'revoked':[]}
 write_new(trust,canonical(value)+b'\n',0o644);return {'keyId':kid,'scope':scope}

def validate_payload(p):
 require(set(p)=={'schema','scope','sequence','issuedAt','expiresAt','platform','acceptedPredecessors','artifacts','releaseSha256'},'Unknown/missing payload fields')
 require(p['schema']=='alica-release-admission/v1' and p['scope'] in ('qa','production'),'Unsupported signature schema/scope')
 require(all(type(p[k]) is int for k in ('sequence','issuedAt','expiresAt')),'Non-integer sequence/time')
 require(p['sequence']>0 and 0<=p['issuedAt']<p['expiresAt'],'Invalid sequence/validity')
 require(p['expiresAt']-p['issuedAt']<=31*86400,'Excessive validity window')
 require(p['platform']=='linux/amd64','Unsupported platform')
 require(isinstance(p['acceptedPredecessors'],list) and 0<len(p['acceptedPredecessors'])<=100,'Missing predecessor policy')
 for s in p['acceptedPredecessors']:sha(s)
 require(len(set(p['acceptedPredecessors']))==len(p['acceptedPredecessors']),'Duplicate predecessor')
 require(isinstance(p['artifacts'],dict) and 0<len(p['artifacts'])<=100000,'Invalid artifact map')
 for n,h in p['artifacts'].items():safe_name(n);sha(h)
 sha(p['releaseSha256']);require(p['artifacts'].get('release.json')==p['releaseSha256'],'Release identity mismatch')

def sign(payload,private):
 validate_payload(payload);key=serialization.load_pem_private_key(owned(private,True).read_bytes(),password=None)
 require(isinstance(key,Ed25519PrivateKey),'Wrong signing algorithm');public=key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)
 return {'schema':'alica-release-envelope/v1','keyId':key_id(public),'payload':payload,'signature':base64.b64encode(key.sign(DOMAIN+canonical(payload))).decode()}

def verify(envelope,trust,root,current,sequence,scope,now=None):
 now=int(time.time()) if now is None else now
 require(set(envelope)=={'schema','keyId','payload','signature'} and envelope['schema']=='alica-release-envelope/v1','Unsigned/unsupported envelope')
 require(trust.get('schema')=='alica-release-trust/v1' and trust.get('scope')==scope,'Wrong trust scope')
 require(type(sequence) is int and sequence>=0,'Invalid installed sequence');sha(current)
 kid=envelope['keyId'];sha(kid);require(kid in trust['keys'] and kid not in trust['revoked'],'Unknown/revoked signing key')
 try:
  public=base64.b64decode(trust['keys'][kid],validate=True);require(key_id(public)==kid,'Trust key fingerprint mismatch')
  signature=base64.b64decode(envelope['signature'],validate=True);Ed25519PublicKey.from_public_bytes(public).verify(signature,DOMAIN+canonical(envelope['payload']))
 except Exception as exc:raise Denied('Signature verification failed') from exc
 p=envelope['payload'];validate_payload(p);require(p['scope']==scope,'Release scope mismatch')
 require(p['issuedAt']<=now<p['expiresAt'],'Expired/not-yet-valid release');require(p['sequence']>sequence,'Replay/downgrade denied')
 require(current in p['acceptedPredecessors'],'Unsupported predecessor')
 require(inventory(root)==p['artifacts'],'Artifact missing, extra or modified')
 return {'signatureVerified':True,'artifactsVerified':len(p['artifacts']),'releaseSha256':p['releaseSha256'],'keyId':kid,'scope':scope,'sequence':p['sequence'],'installationPerformed':False,'schemaCompatibilityProven':False,'sbomProvenanceGateComplete':False,'wholeStage6Accepted':False}

def main():
 parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='action',required=True)
 k=sub.add_parser('keygen');k.add_argument('--private',required=True);k.add_argument('--trust',required=True);k.add_argument('--scope',choices=['qa','production'],required=True)
 i=sub.add_parser('inventory');i.add_argument('--bundle',required=True)
 s=sub.add_parser('sign');s.add_argument('--payload',required=True);s.add_argument('--private',required=True)
 v=sub.add_parser('verify');v.add_argument('--envelope',required=True);v.add_argument('--trust',required=True);v.add_argument('--bundle',required=True);v.add_argument('--current',required=True);v.add_argument('--installed-sequence',type=int,required=True);v.add_argument('--scope',choices=['qa','production'],required=True)
 a=parser.parse_args()
 if a.action=='keygen':out=keygen(a.private,a.trust,a.scope)
 elif a.action=='inventory':out=inventory(a.bundle)
 elif a.action=='sign':out=sign(load(a.payload),a.private)
 else:
  trust=owned(a.trust);require(Path(a.bundle).resolve() not in trust.resolve().parents,'Bundle-supplied trust forbidden')
  out=verify(load(a.envelope),load(trust),a.bundle,a.current,a.installed_sequence,a.scope)
 print(json.dumps(out,sort_keys=True))
if __name__=='__main__':main()
