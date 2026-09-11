"""Packaging unit fixtures only; not installation or independent acceptance."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('stage7_package',Path(__file__).with_name('package.py'));assert spec and spec.loader;m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Packaging(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.base=self.root/'base';self.base.mkdir();self.ref=self.root/'reference.tar';self.ref.write_bytes(b'explicit unit fixture, not a real OCI image')
  ops=Path(__file__).parents[1]/'stage5/ops.py'
  (self.base/'ops.py').write_bytes(ops.read_bytes());(self.base/'images.tar').write_bytes(b'explicit unit fixture, not a real OCI image')
  release={'schema':'dsh-stage2-bundle/v1','source_revisions':{'installer':'original'},'files':{p.name:m.sha(p) for p in self.base.iterdir()}}
  (self.base/'release.json').write_text(json.dumps(release))
  self.dog=self.root/'doghouse';self.dog.mkdir()
  for i in range(7):(self.dog/f'module{i}.py').write_text('# unit fixture only\n')
  self.out=self.root/'output'
 def build(self):
  with patch.object(m,'BASE',m.sha(self.base/'release.json')),patch.object(m,'REF',m.sha(self.ref)):
   m.produce(self.base,self.ref,self.dog,self.out,'a'*40,'b'*40)
 def test_real_ops_transform_and_manifest(self):
  self.build();b=self.out/'bundle';r=json.loads((b/'release.json').read_text());s=(b/'ops.py').read_text();compile(s,'ops.py','exec')
  self.assertIn("'signatureSchema':SCHEMA",s);self.assertIn('canonical_signature as signature',s)
  self.assertIn('UNQUALIFIED',r['acceptance']);self.assertFalse(r['stage7_assembly']['productionAccepted'])
  for n,h in r['files'].items():self.assertEqual(m.sha(b/n),h)
  self.assertEqual((self.base/'images.tar').read_bytes(),(b/'images.tar').read_bytes())
 def test_tampered_file_denied(self):
  (self.base/'ops.py').write_text('tampered')
  with self.assertRaises(AssertionError):self.build()
  self.assertFalse(self.out.exists())
 def test_existing_output_denied(self):
  self.out.mkdir()
  with self.assertRaises(AssertionError):self.build()
 def test_symlinked_artifact_denied(self):
  original=self.base/'images.tar';saved=self.root/'saved';original.rename(saved);original.symlink_to(saved)
  with self.assertRaises(AssertionError):self.build()
  self.assertFalse(self.out.exists())
if __name__=='__main__':unittest.main()
