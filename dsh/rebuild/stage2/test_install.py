import json,ssl,tempfile,unittest
from pathlib import Path
from install import Installer,SERVICES,TransactionError,sha
from render import render

class Preparation(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.bundle=self.base/'bundle';self.bundle.mkdir();self.root=self.base/'dsh2-test';self.root.mkdir(mode=0o700)
  self.request={'cell':'dsh2-test','origin':'https://stage2.dsh.invalid:19443','bind':'127.0.0.1','port':19443,'owner':'owner'}
  template_request={**self.request,'cell':'dsh2-template'}
  (self.bundle/'compose.template.json').write_text(json.dumps(render(template_request)));(self.bundle/'frameworks.json').write_text('{}')
  self.installer=Installer.__new__(Installer);self.installer.root=self.root;self.installer.bundle=self.bundle;self.installer.r=self.request
  self.installer.release={'release':'unit-fixture','images':{k:{'id':'sha256:'+'0'*64,'oci_reference':'fixture@sha256:'+'0'*64} for k in SERVICES}}
 def tearDown(self):self.tmp.cleanup()
 def test_real_strict_pki_and_repeat_preserve_secrets(self):
  self.installer.prepare();before={str(p.relative_to(self.root)):sha(p) for p in self.root.rglob('*') if p.is_file()};self.installer.prepare()
  after={str(p.relative_to(self.root)):sha(p) for p in self.root.rglob('*') if p.is_file()};self.assertEqual(before,after)
  context=ssl.create_default_context(cafile=str(self.root/'secrets/framework-ca.crt'));self.assertTrue(context.check_hostname)
 def test_unsafe_secret_directory_rejected(self):
  outside=self.base/'outside';outside.mkdir();(self.root/'secrets').symlink_to(outside)
  with self.assertRaises(TransactionError):self.installer.prepare()
  self.assertEqual(list(outside.iterdir()),[])
 def test_modified_compose_rejected(self):
  self.installer.prepare();(self.root/'compose.json').chmod(0o600);(self.root/'compose.json').write_text('{}')
  with self.assertRaises(TransactionError):self.installer.prepare()
 def test_changed_secret_rejected_without_rewriting_database_config(self):
  self.installer.prepare();p=self.root/'secrets/postgres-password';before=sha(self.root/'secrets/core-database-url');p.chmod(0o600);p.write_text('changed-fixture\n')
  with self.assertRaises(TransactionError):self.installer.prepare()
  self.assertEqual(before,sha(self.root/'secrets/core-database-url'))
