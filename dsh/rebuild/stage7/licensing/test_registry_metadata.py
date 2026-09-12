"""Synthetic parser fixtures; no network and no legal approval."""
import json,unittest
from unittest.mock import patch
import collect_registry_metadata as c

def xml(artifact='a',namespace='',licence=True,parent=''):
 return ('<project'+namespace+'><groupId>g</groupId><artifactId>'+artifact+'</artifactId><version>1</version>'+parent+('<licenses><license><name>TEST-LICENCE</name></license></licenses>' if licence else '')+'</project>').encode()
class RegistryTests(unittest.TestCase):
 def test_namespaces(self):
  for ns in ['', ' xmlns="http://maven.apache.org/POM/4.0.0"']:
   with patch.object(c,'get',return_value=(xml(namespace=ns),{'url':'fixture'})):
    self.assertEqual(c.pom('g','a','1')[0][0]['name'],'TEST-LICENCE')
 def test_mismatch(self):
  with patch.object(c,'get',return_value=(xml(artifact='wrong'),{})):
   with self.assertRaisesRegex(ValueError,'identity mismatch'):c.pom('g','a','1')
 def test_inherited(self):
  parent='<parent><groupId>g</groupId><artifactId>parent</artifactId><version>1</version></parent>'
  with patch.object(c,'get',side_effect=[(xml(licence=False,parent=parent),{'url':'child'}),(xml(artifact='parent'),{'url':'parent'})]):
   licenses,chain,inherited=c.pom('g','a','1');self.assertTrue(inherited);self.assertEqual(len(chain),2);self.assertTrue(licenses)
 def test_entity_rejected(self):
  with patch.object(c,'get',return_value=(b'<!DOCTYPE project>'+xml(),{})):
   with self.assertRaisesRegex(ValueError,'Unsafe XML'):c.pom('g','a','1')
 def test_unsafe_coordinates(self):
  for s in ['../secret','${version}','/absolute','a/b','a?x']:
   with self.assertRaises(ValueError):c.coordinate(s)
 def test_pypi_identity(self):
  with patch.object(c,'get',return_value=(json.dumps({'info':{'name':'wrong','version':'1'}}).encode(),{})):
   with self.assertRaisesRegex(ValueError,'identity mismatch'):c.pypi('a','1')
 def test_no_approval(self):
  with patch.object(c,'pom',return_value=([{'name':'TEST-LICENCE'}],[],False)):
   r=c.collect('pkg:maven/g/a@1');self.assertFalse(r['legalDispositionApproved']);self.assertFalse(r['binaryIdentityProven'])
@unittest.skipUnless((c.BASE/'registry-review-v2/report.json').exists(),'Requires retained registry evidence')
class RetainedEvidenceTests(unittest.TestCase):
 def setUp(self):
  import tempfile,shutil
  from pathlib import Path
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)/'evidence';shutil.copytree(c.BASE/'registry-review-v2',self.base)
 def test_changed_object(self):
  from verify_registry_metadata import verify
  d=json.loads((self.base/'report.json').read_text());p=self.base/'objects'/d['sources'][0]['sha256'];p.write_bytes(p.read_bytes()+b' ')
  with self.assertRaisesRegex(ValueError,'hash mismatch'):verify(self.base)
 def test_claimed_approval(self):
  from verify_registry_metadata import verify
  p=self.base/'report.json';d=json.loads(p.read_text());d['stage74Accepted']=True;p.write_text(json.dumps(d))
  with self.assertRaisesRegex(ValueError,'Not an approval verifier'):verify(self.base)
 def test_queue_approval(self):
  from verify_registry_metadata import verify
  p=self.base/'review-queue.json';d=json.loads(p.read_text());d[0]['legalDispositionApproved']=True;p.write_text(json.dumps(d))
  with self.assertRaisesRegex(ValueError,'Unexpected queue alteration'):verify(self.base)
if __name__=='__main__':unittest.main()
