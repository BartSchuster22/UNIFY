import copy,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import archive as a

class ArchiveTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.b=Path(self.tmp.name);self.src=self.b/'source';self.src.mkdir();(self.src/'state').write_bytes(b'fixture-only\x00state');(self.src/'sub').mkdir();(self.src/'sub'/'link').symlink_to('../state')
  self.key=self.b/'key';subprocess.run(['age-keygen','-o',str(self.key)],capture_output=True,check=True);self.pub=subprocess.check_output(['age-keygen','-y',str(self.key)],text=True).strip()
  self.spec=self.b/'spec';self.spec.write_text(json.dumps({'quiesced':True,'metadata':{'fixture':True},'sources':{'data':str(self.src)}}));self.out=self.b/'backup.age'
 def tearDown(self):self.tmp.cleanup()
 def make(self):return a.create(self.spec,self.pub,self.out)
 def test_roundtrip(self):
  r=self.make();v=a.verify(self.out,self.key,r['ciphertextSha256'],self.b/'restored');self.assertTrue(v['contentsVerified']);self.assertEqual((self.b/'restored/data/state').read_bytes(),(self.src/'state').read_bytes());self.assertEqual(os.readlink(self.b/'restored/data/sub/link'),'../state')
 def test_sticky_directory_preserved(self):
  (self.src/'sub').chmod(0o1777);r=self.make();a.verify(self.out,self.key,r['ciphertextSha256'],self.b/'restored');self.assertEqual((self.b/'restored/data/sub').stat().st_mode&0o7777,0o1777)
 def test_setuid_file_denied(self):
  (self.src/'state').chmod(0o4755)
  with self.assertRaises(ValueError):self.make()
 def test_hardlink_preserved(self):
  os.link(self.src/'state',self.src/'same');r=self.make();a.verify(self.out,self.key,r['ciphertextSha256'],self.b/'restored');self.assertEqual((self.b/'restored/data/state').stat().st_ino,(self.b/'restored/data/same').stat().st_ino)
 def test_hardlink_escape_denied(self):
  import io,tarfile
  os.link(self.src/'state',self.src/'same');self.make();plain=subprocess.check_output(['age','-d','-i',str(self.key),str(self.out)]);buf=io.BytesIO()
  with tarfile.open(fileobj=io.BytesIO(plain),mode='r:gz') as src,tarfile.open(fileobj=buf,mode='w:gz') as dst:
   for member in src:
    if member.islnk():member.linkname='../outside'
    dst.addfile(member,src.extractfile(member) if member.isfile() else None)
  self.out.write_bytes(subprocess.check_output(['age','-r',self.pub],input=buf.getvalue()))
  with self.assertRaises(ValueError):a.verify(self.out,self.key,a.digest(self.out))
 def test_wrong_digest(self):
  self.make()
  with self.assertRaises(ValueError):a.verify(self.out,self.key,'0'*64)
 def test_wrong_key(self):
  r=self.make();other=self.b/'other';subprocess.run(['age-keygen','-o',str(other)],capture_output=True,check=True)
  with self.assertRaises(Exception):a.verify(self.out,other,r['ciphertextSha256'])
 def test_tamper_authentication(self):
  self.make();raw=bytearray(self.out.read_bytes());raw[-1]^=1;self.out.write_bytes(raw)
  with self.assertRaises(Exception):a.verify(self.out,self.key,a.digest(self.out))
 def test_truncation(self):
  self.make();self.out.write_bytes(self.out.read_bytes()[:-12])
  with self.assertRaises(Exception):a.verify(self.out,self.key,a.digest(self.out))
 def test_existing_destination(self):
  r=self.make()
  with self.assertRaises(ValueError):a.verify(self.out,self.key,r['ciphertextSha256'],self.src)
 def test_existing_output(self):
  self.make()
  with self.assertRaises(ValueError):self.make()
 def test_quiescence_required(self):
  s=json.loads(self.spec.read_text());s['quiesced']=False;self.spec.write_text(json.dumps(s))
  with self.assertRaises(ValueError):self.make()
 def test_absolute_link(self):
  (self.src/'evil').symlink_to('/etc/passwd')
  with self.assertRaises(ValueError):self.make()
 def test_escape_link(self):
  (self.src/'evil').symlink_to('../outside')
  with self.assertRaises(ValueError):self.make()
 def test_special_file(self):
  os.mkfifo(self.src/'fifo')
  with self.assertRaises(ValueError):self.make()
 def test_bad_names(self):
  for n in ('../x','/x','x/../y','x//y','x/./y','x\\y',''):
   with self.subTest(n=n),self.assertRaises(ValueError):a.name_ok(n)
 def test_duplicate_manifest(self):
  row=a.entry(self.src,'data')
  with self.assertRaises(ValueError):a.validate_manifest({'schema':a.SCHEMA,'entries':[row,row]})
 def test_non_directory_ancestor(self):
  row=a.entry(self.src/'state','data');child=copy.deepcopy(row);child['name']='data/child'
  with self.assertRaises(ValueError):a.validate_manifest({'schema':a.SCHEMA,'entries':[row,child]})
 def test_changed_source(self):
  original=a.entry;count=0
  def changing(path,name):
   nonlocal count
   count+=1;r=original(path,name)
   if count>4:r['mtime']+=1
   return r
  with patch.object(a,'entry',changing),self.assertRaises(ValueError):self.make()
  self.assertFalse(self.out.exists())

if __name__=='__main__':unittest.main()
