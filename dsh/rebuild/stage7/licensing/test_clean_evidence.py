import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import bind_clean_evidence as b
import package_clean_materials as materials
class ContinuityTests(unittest.TestCase):
    def test_matching_name_is_not_proof(self):
        r={'locations':[{'path':'/bin/x'}]};self.assertEqual(b.continuity(r,{'name':'x'},{'bin/x':{'sha256':'a'*64}}),[])
    def test_exact_primary_hash(self):
        r={'locations':[{'path':'/bin/x'}]};old={'evidence':[{'path':'bin/x','sha256':'a'*64}]}
        self.assertEqual(len(b.continuity(r,old,{'bin/x':{'sha256':'a'*64}})),1)
        self.assertEqual(b.continuity(r,old,{'bin/x':{'sha256':'b'*64}}),[])
        self.assertEqual(b.continuity(r,old,{'bin/y':{'sha256':'a'*64}}),[])
    def test_notice_name_is_not_primary_identity(self):
        self.assertEqual(b.continuity({'locations':[{'path':'/bin/x'}]},{'path':'LICENSE','sha256':'a'*64},{'LICENSE':{'sha256':'a'*64}}),[])
class MaterialTests(unittest.TestCase):
    def test_changed_source_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'fixture_1').mkdir();p=root/'fixture_1/x.dsc';p.write_bytes(b'fixture')
            report={'results':[{'name':'fixture','version':'1','status':'exact-dsc-source-materials-collected','dsc':{'name':'x.dsc','sha256':hashlib.sha256(b'fixture').hexdigest()},'materials':[]}]}
            self.assertEqual(len(materials.source_files(report,root)),1);p.write_bytes(b'changed')
            with self.assertRaises(ValueError):materials.source_files(report,root)
    def test_unresolved_source_rejected(self):
        with self.assertRaises(ValueError):materials.source_files({'results':[{'name':'x','version':'1','status':'unresolved'}]},Path('/unused'))
class CandidateReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.files=b.derive()
    def test_real_packet_replays(self):
        for name,data in self.files.items():self.assertEqual((b.OUT/name).read_bytes(),data,name)
    def test_verdict_matches_open_work(self):
        s=json.loads(self.files['candidate-summary.json']);r=json.loads(self.files['candidate-package-evidence.json'])
        self.assertEqual(s['softwareOccurrences'],len(r));self.assertEqual(s['metadataUnresolved'],sum(x['engineeringChecks']['metadata']=='unresolved' for x in r));self.assertFalse(s['engineeringComplete']);self.assertFalse(s['fullStackRequalified'])
    def test_edited_completion_rejected(self):
        original=Path.read_bytes;target=b.OUT/'candidate-summary.json';changed=json.loads(self.files['candidate-summary.json']);changed['engineeringComplete']=True
        def read(p):return b.dump(changed) if p==target else original(p)
        with patch.object(b,'derive',return_value=self.files),patch.object(Path,'read_bytes',read),patch('sys.argv',['bind_clean_evidence','--verify']):
            with self.assertRaisesRegex(ValueError,'Changed candidate evidence'):b.main()
if __name__=='__main__':unittest.main()
