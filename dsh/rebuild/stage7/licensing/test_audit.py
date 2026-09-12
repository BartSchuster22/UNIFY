"""Fixture tests of SBOM identity/digest rejection, not dependency licence clearance."""
import hashlib,tempfile,unittest
from pathlib import Path
from audit import sbom_status,sha
class AuditTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.path=Path(self.tmp.name)/'fixture.json';self.path.write_bytes(b'{}')
  self.record={'imageId':'sha256:fixture','sha256':hashlib.sha256(b'{}').hexdigest()}
 def test_missing_record(self):self.assertEqual(sbom_status('sha256:fixture',None,self.path),'missing')
 def test_changed_image(self):self.assertEqual(sbom_status('sha256:changed',self.record,self.path),'stale-image')
 def test_missing_file(self):
  self.path.unlink();self.assertEqual(sbom_status('sha256:fixture',self.record,self.path),'invalid-digest')
 def test_changed_file(self):
  self.path.write_bytes(b'{"changed":true}');self.assertEqual(sbom_status('sha256:fixture',self.record,self.path),'invalid-digest')
 def test_matching_is_not_clearance(self):self.assertEqual(sbom_status('sha256:fixture',self.record,self.path),'matched-observation-not-legal-clearance')
 def test_streaming_hash(self):self.assertEqual(sha(self.path),hashlib.sha256(b'{}').hexdigest())
if __name__=='__main__':unittest.main()
