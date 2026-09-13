import hashlib,io,json,sys,tarfile,unittest
from pathlib import Path
from unittest.mock import patch
import freeze_clean_candidate as f
import resolve_step2_records as r
class Steps12Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.outputs=r.derive();cls.rows=json.loads(cls.outputs['individual-records.json']);cls.status=json.loads(cls.outputs['current-metadata-status.json'])
    def test_exact_frozen_scope(self):
        gaps=json.loads((r.B/'candidate-metadata-gaps.json').read_bytes());self.assertEqual({(x['image'],x['artifactId']) for x in gaps},{(x['image'],x['artifactId']) for x in self.rows});self.assertEqual(len(self.rows),34)
    def test_only_two_steps_complete(self):
        self.assertTrue(self.status['step1Complete']);self.assertTrue(self.status['step2Complete']);self.assertFalse(self.status['engineeringComplete']);self.assertFalse(self.status['legalApproval']);self.assertFalse(self.status['fullStackRequalified']);self.assertFalse(self.status['otherObligationDecisionsChanged'])
    def test_not_blanket_dispositions(self):
        self.assertTrue(all(x['evidence'] and x['rationale'] for x in self.rows));self.assertTrue(all(not x['otherObligationsClosed'] and not x['commercialApproval'] for x in self.rows))
    def test_none_only_for_zero_payload_record(self):
        self.assertEqual([x['scannerName'] for x in self.rows if x['licenceExpression']=='NONE'],['.postgresql-rundeps'])
    def test_generated_jar_is_not_dependency_exemption(self):
        x=next(x for x in self.rows if x['scannerName']=='quarkus-run');self.assertFalse(x['facts']['containsProgramClasses']);self.assertTrue(x['facts']['classpathDependenciesNotExempted'])
    def test_proprietary_not_unlicense_or_legal_approval(self):
        rows=[x for x in self.rows if x['classification']=='first-party-restricted'];self.assertEqual(len(rows),4)
        for x in rows:self.assertIn('Proprietary',x['licenceExpression']);self.assertIn('ALICA Ltd',x['facts']['legalHold']);self.assertFalse(x['facts']['newLicenceGrant'])
    def test_mixed_licence_not_collapsed(self):
        by={x['scannerName']:x for x in self.rows};self.assertEqual(by['gopkg.in/yaml.v3']['licenceExpression'],'MIT AND Apache-2.0');self.assertEqual(by['github.com/google/cel-go']['licenceExpression'],'Apache-2.0 AND BSD-3-Clause');self.assertIn('MIT',by['github.com/klauspost/compress']['licenceExpression'])
    def test_runtime_bundles_not_single_licence_claims(self):
        for x in self.rows:
            if x['scannerName'] in ['node','python','jrt-fs']:self.assertTrue(x['licenceExpression'].startswith('LicenseRef-'))
    def test_all_documents_really_delivered(self):
        with tarfile.open(fileobj=io.BytesIO(self.outputs['metadata-evidence.tar'])) as t:
            for x in self.rows:
                for d in x['evidence']:
                    raw=r.member_bytes(t,d['archivePath']);self.assertEqual(hashlib.sha256(raw).hexdigest(),d['sha256'])
    def test_node_and_gosu_have_byte_identity(self):
        for x in self.rows:
            if x['scannerName']=='node':self.assertEqual(len(x['facts']['exactBinaryMatch']['sha256']),64)
            if x['scannerName']=='github.com/tianon/gosu':self.assertEqual(x['facts']['resolvedVersion'],'1.17');self.assertEqual(len(x['facts']['exactReleaseBinary']['sha256']),64)
    def test_hindsight_payload_not_name_only(self):
        x=next(x for x in self.rows if x['scannerName']=='hindsight-client');self.assertGreater(x['facts']['verifiedClientFiles'],1)
    def test_deterministic_replay(self):self.assertEqual(self.outputs,r.derive())
    def mutation(self,path,raw):
        original=Path.read_bytes;target=Path(path)
        def altered(p):return raw if p==target else original(p)
        with patch.object(Path,'read_bytes',altered):
            with self.assertRaises((ValueError,KeyError)):r.derive()
    def test_changed_lock_rejected(self):
        p=r.OUT/'candidate-lock.json';v=json.loads(p.read_bytes());v['images']['hermes']['imageId']='sha256:'+'0'*64;self.mutation(p,r.enc(v))
    def test_changed_inventory_rejected(self):
        p=r.B/'candidate-metadata-gaps.json';v=json.loads(p.read_bytes());v.pop();self.mutation(p,r.enc(v))
    def test_changed_source_notice_rejected(self):
        u=json.loads((r.B/'steps12-upstream/report.json').read_bytes());d=u['hindsight']['sourceDocuments'][0]['source'];p=r.B/'steps12-upstream/objects'/d['sha256'];self.mutation(p,p.read_bytes()+b' Changed terms')
    def test_changed_binary_identity_rejected(self):
        p=r.B/'step2-go-identities.json';v=json.loads(p.read_bytes());v[0]['sha256']='0'*64;self.mutation(p,r.enc(v))
    def test_completion_flag_tamper_rejected_by_cli(self):
        p=r.OUT/'current-metadata-status.json';original=Path.read_bytes
        def altered(path):
            if path==p:
                v=json.loads(self.outputs['current-metadata-status.json']);v['engineeringComplete']=True;return r.enc(v)
            return original(path)
        with patch.object(Path,'read_bytes',altered),patch.object(sys,'argv',['resolve_step2_records.py','--verify']):
            with self.assertRaises(ValueError):r.main()
    def test_freeze_create_cannot_overwrite(self):
        with patch.object(sys,'argv',['freeze_clean_candidate.py','--create']):
            with self.assertRaises(FileExistsError):f.main()
if __name__=='__main__':unittest.main()
