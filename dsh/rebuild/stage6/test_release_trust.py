import copy,json,os,tempfile,time,unittest
from pathlib import Path
import release_trust as r

class TrustTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='.alica-trust-test-',dir=Path.home());self.base=Path(self.tmp.name);self.bundle=self.base/'bundle';self.bundle.mkdir();(self.bundle/'release.json').write_text('{"fixture":true}');(self.bundle/'payload').write_bytes(b'unit fixture, not an installed release');self.key=self.base/'private.pem';self.trust_path=self.base/'trust.json';r.keygen(self.key,self.trust_path,'qa');self.trust=r.load(self.trust_path);self.now=int(time.time());self.current='a'*64
  files=r.inventory(self.bundle);self.payload={'schema':'alica-release-admission/v1','scope':'qa','sequence':1,'issuedAt':self.now,'expiresAt':self.now+3600,'platform':'linux/amd64','acceptedPredecessors':[self.current],'artifacts':files,'releaseSha256':files['release.json']};self.envelope=r.sign(self.payload,self.key)
 def tearDown(self):self.tmp.cleanup()
 def verify(self,**changes):
  args={'envelope':self.envelope,'trust':self.trust,'root':self.bundle,'current':self.current,'sequence':0,'scope':'qa','now':self.now};args.update(changes);return r.verify(**args)
 def signed_change(self,**changes):
  p=copy.deepcopy(self.payload);p.update(changes);self.envelope=r.sign(p,self.key)
 def test_valid(self):
  v=self.verify();self.assertTrue(v['signatureVerified']);self.assertFalse(v['installationPerformed']);self.assertFalse(v['schemaCompatibilityProven'])
 def test_tampered_file(self):
  (self.bundle/'payload').write_text('tampered')
  with self.assertRaises(r.Denied):self.verify()
 def test_missing_file(self):
  (self.bundle/'payload').unlink()
  with self.assertRaises(r.Denied):self.verify()
 def test_extra_file(self):
  (self.bundle/'unexpected.py').write_text('raise RuntimeError')
  with self.assertRaises(r.Denied):self.verify()
 def test_symlink(self):
  (self.bundle/'link').symlink_to('payload')
  with self.assertRaises(r.Denied):self.verify()
 def test_special_file(self):
  os.mkfifo(self.bundle/'fifo')
  with self.assertRaises(r.Denied):self.verify()
 def test_signature_tamper(self):
  self.envelope['signature']='A'*88
  with self.assertRaises(r.Denied):self.verify()
 def test_payload_tamper(self):
  self.envelope['payload']['sequence']=2
  with self.assertRaises(r.Denied):self.verify()
 def test_unknown_key(self):
  self.trust['keys']={}
  with self.assertRaises(r.Denied):self.verify()
 def test_revoked(self):
  self.trust['revoked']=[self.envelope['keyId']]
  with self.assertRaises(r.Denied):self.verify()
 def test_wrong_public_key(self):
  self.trust['keys'][self.envelope['keyId']]='A'*44
  with self.assertRaises(r.Denied):self.verify()
 def test_expired(self):
  with self.assertRaises(r.Denied):self.verify(now=self.now+3600)
 def test_future(self):
  with self.assertRaises(r.Denied):self.verify(now=self.now-1)
 def test_replay(self):
  with self.assertRaises(r.Denied):self.verify(sequence=1)
 def test_downgrade(self):
  with self.assertRaises(r.Denied):self.verify(sequence=2)
 def test_predecessor(self):
  with self.assertRaises(r.Denied):self.verify(current='b'*64)
 def test_qa_cannot_be_production(self):
  with self.assertRaises(r.Denied):self.verify(scope='production')
 def test_signature_scope_mismatch(self):
  self.signed_change(scope='production')
  with self.assertRaises(r.Denied):self.verify()
 def test_unsigned(self):
  del self.envelope['signature']
  with self.assertRaises(r.Denied):self.verify()
 def test_traversal(self):
  self.payload['artifacts']['../evil']='c'*64
  with self.assertRaises(r.Denied):r.sign(self.payload,self.key)
 def test_platform(self):
  with self.assertRaises(r.Denied):self.signed_change(platform='linux/arm64')
 def test_boolean_sequence(self):
  with self.assertRaises(r.Denied):self.signed_change(sequence=True)
 def test_unknown_payload_field(self):
  with self.assertRaises(r.Denied):self.signed_change(runCommand='not allowed')
 def test_duplicate_json_key(self):
  p=self.base/'bad.json';p.write_text('{"a":1,"a":2}')
  with self.assertRaises(r.Denied):r.load(p)
 def test_nonfinite_json(self):
  p=self.base/'bad.json';p.write_text('{"a":NaN}')
  with self.assertRaises(r.Denied):r.load(p)
 def test_world_readable_private_key(self):
  self.key.chmod(0o644)
  with self.assertRaises(r.Denied):r.sign(self.payload,self.key)
 def test_writable_trust(self):
  self.trust_path.chmod(0o666)
  with self.assertRaises(r.Denied):r.owned(self.trust_path)
 def test_group_writable_parent_denied_before_key_creation(self):
  folder=self.base/'unsafe';folder.mkdir(mode=0o700);folder.chmod(0o770)
  with self.assertRaises(r.Denied):r.keygen(folder/'private',folder/'trust','qa')
  self.assertFalse((folder/'private').exists())
 def test_symlinked_parent_denied(self):
  alias=self.base/'alias';alias.symlink_to(self.base,target_is_directory=True)
  with self.assertRaises(r.Denied):r.owned(alias/'trust.json')
 def test_existing_key_refused(self):
  before=self.key.read_bytes()
  with self.assertRaises(r.Denied):r.keygen(self.key,self.trust_path,'qa')
  self.assertEqual(before,self.key.read_bytes())
if __name__=='__main__':unittest.main()
