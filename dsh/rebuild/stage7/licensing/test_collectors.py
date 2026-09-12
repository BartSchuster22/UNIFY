"""Fixture tests only. Run with Python >=3.11 (tomllib), separately from live receipts."""
import hashlib,io,json,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import collect_current as current
import collect_notices_v2 as notices
import collect_rust_evidence as rust

def archive(entries):
 out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w') as t:
  for name,data,kind,target in entries:
   m=tarfile.TarInfo(name);m.type=kind;m.linkname=target;m.size=len(data) if kind==tarfile.REGTYPE else 0;t.addfile(m,io.BytesIO(data) if m.isfile() else None)
 return out.getvalue()
def file(name,data):return (name,data,tarfile.REGTYPE,'')
class CollectorTests(unittest.TestCase):
 def test_guard(self):
  with self.assertRaises(RuntimeError):current.require(False,'fixture rejection')
 def test_notice_names(self):
  for path in ['LICENSE','THIRD-PARTY-NOTICES.md','x/licenses/MIT.txt','usr/share/common-licenses/GPL-2','COPYING.LESSER']:self.assertTrue(notices.candidate(path),path)
 def test_non_notice_names(self):
  for path in ['app.py','README.md','LICENSED-DATA-NOT-REQUESTED.json']:
   self.assertFalse(notices.candidate(path),path)
 def test_reference_and_whiteout_fixture(self):
  with tempfile.TemporaryDirectory() as td:
   base=Path(td)/'bundle';base.mkdir();out=Path(td)/'result'
   layer1=archive([file('usr/share/common-licenses/MIT',b'fixture notice'),('x/LICENSE',b'',tarfile.SYMTYPE,'../usr/share/common-licenses/MIT'),('x/licenses',b'',tarfile.DIRTYPE,'')])
   layer2=archive([file('usr/share/common-licenses/.wh.MIT',b''),('y/LICENSE',b'',tarfile.SYMTYPE,'../usr/share/common-licenses/MIT')])
   config=b'{"fixture":true}';c=hashlib.sha256(config).hexdigest();layers=[hashlib.sha256(x).hexdigest() for x in [layer1,layer2]]
   manifest=[{'Config':c,'Layers':layers}];data=archive([file('manifest.json',json.dumps(manifest).encode()),file(c,config),file(layers[0],layer1),file(layers[1],layer2)])
   for name in ['images.tar','reference-image.tar']:(base/name).write_bytes(data)
   release=json.dumps({'files':{n:hashlib.sha256(data).hexdigest() for n in ['images.tar','reference-image.tar']}}).encode();(base/'release.json').write_bytes(release)
   with patch.object(notices,'B',base),patch.object(notices,'O',out),patch.object(notices,'RELEASE',hashlib.sha256(release).hexdigest()):notices.main()
   report=json.loads((out/'notice-index.json').read_text());self.assertEqual(len(report['resolvedReferences']),1);self.assertEqual(len(report['gaps']),1);self.assertFalse(report['legalCoverageComplete']);self.assertEqual(report['uniqueContents'],1)
 def test_rust_coordinate_guard(self):
  data=archive([file('a-1.0.0/Cargo.toml',b'[package]\nname="wrong"\nversion="1.0.0"\n')]);compressed=__import__('gzip').compress(data)
  with self.assertRaises(RuntimeError):rust.inspect_source(compressed,'a','1.0.0')
 def test_rust_exact_manifest_and_notice(self):
  with tempfile.TemporaryDirectory() as td:
   out=Path(td);(out/'texts').mkdir();data=archive([file('a-1.0.0/Cargo.toml',b'[package]\nname="a"\nversion="1.0.0"\nlicense="MIT"\n'),file('a-1.0.0/LICENSE',b'fixture only')])
   with patch.object(rust,'O',out):r=rust.inspect_source(__import__('gzip').compress(data),'a','1.0.0')
   self.assertEqual(r['cargoDeclaredLicense'],'MIT');self.assertEqual(len(r['noticeCandidates']),1)
if __name__=='__main__':unittest.main()
