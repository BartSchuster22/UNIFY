import hashlib,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import collect_clean_debian_sources as s
class SourceCollectorTests(unittest.TestCase):
    def test_explicit_source_version(self):
        self.assertEqual(s.coordinates({'name':'libx','version':'1.2-1+b2','metadata':{'source':'source-x','sourceVersion':'1.2-1'}}),('source-x','1.2-1'))
    def test_missing_binnmu_rejected(self):
        with self.assertRaises(ValueError):s.coordinates({'name':'x','version':'1+b2','metadata':{}})
    def test_traversal_rejected(self):
        with self.assertRaises(ValueError):s.coordinates({'name':'../x','version':'1','metadata':{}})
    def test_clearsigned_parse(self):
        f=s.dsc_fields(b'-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nSource: x\nVersion: 1\nChecksums-Sha256:\n abc 3 x.tar.xz\n-----BEGIN PGP SIGNATURE-----\nVersion: wrong\n');self.assertEqual(f['Version'],'1');self.assertEqual(f['Checksums-Sha256'].strip(),'abc 3 x.tar.xz')
    def test_material_verification(self):
        data=b'unit test source fixture';h=hashlib.sha256(data).hexdigest();dsc=f'Source: x\nVersion: 1\nFormat: 3.0 (native)\nChecksums-Sha256:\n {h} {len(data)} x_1.tar.xz\n'.encode()
        for raw,expected in [(data,'exact-dsc-source-materials-collected'),(b'corrupt','unresolved')]:
            with self.subTest(expected=expected),tempfile.TemporaryDirectory() as d,patch.object(s,'get',side_effect=lambda url,*args:dsc if url.endswith('.dsc') else raw):
                r=s.collect((('x','1'),[]),Path(d));self.assertEqual(r['status'],expected);self.assertFalse(r['correspondingSourceAccepted'])
if __name__=='__main__':unittest.main()
