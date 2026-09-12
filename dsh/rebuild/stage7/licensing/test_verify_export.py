"""Negative checks against the real exported collection, without modifying it."""
import hashlib,json,tempfile,unittest
from pathlib import Path
from verify_export import verify
BASE=Path(__file__).parent/'current-qa4'
@unittest.skipUnless((BASE/'export.json').exists(),'Requires exported QA4 evidence')
class ExportTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  for name in ['review-evidence.tar.gz','rust-sources.tar.gz']:(self.base/name).symlink_to((BASE/name).resolve())
  for name in ['export.json','summary.json']:(self.base/name).write_bytes((BASE/name).read_bytes())
 def test_changed_archive_digest_rejected(self):
  p=self.base/'export.json';d=json.loads(p.read_text());d['files']['review-evidence.tar.gz']['sha256']='0'*64;p.write_text(json.dumps(d))
  with self.assertRaisesRegex(RuntimeError,'Export digest mismatch'):verify(self.base)
 def test_changed_summary_rejected(self):
  with (self.base/'summary.json').open('a') as f:f.write(' ')
  with self.assertRaisesRegex(RuntimeError,'Summary changed'):verify(self.base)
 def test_cannot_accept_legal_clearance(self):
  p=self.base/'summary.json';d=json.loads(p.read_text());d['stage74Accepted']=True;p.write_text(json.dumps(d));e=self.base/'export.json';x=json.loads(e.read_text());x['summarySha256']=hashlib.sha256(p.read_bytes()).hexdigest();e.write_text(json.dumps(x))
  with self.assertRaisesRegex(RuntimeError,'cannot accept legal clearance'):verify(self.base)
if __name__=='__main__':unittest.main()
