import copy, io, json, unittest, zipfile
from unittest.mock import patch
import reinspect_original as collect
import bind_original_maven as binding
import match_original_bsd as bsd


class OriginalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inspection=json.loads((binding.OUT/'inspection.json').read_text())
        cls.queue=json.loads(binding.INPUT.read_text())
        cls.row=next(r for r in cls.queue if r['name']=='grpc-core' and r['type']=='java-archive')
        cls.image=json.loads((binding.BASE/'current-qa4/summary.json').read_text())['images']['keycloak']['imageId']
        cls.templates={n:(bsd.OUT/'objects'/r['sha256']).read_text() for n,r in json.loads((bsd.OUT/'templates.json').read_text()).items()}

    def test_original_identity_valid(self):binding.validate_inspection(self.inspection)

    def test_release_mutation_rejected(self):
        x=copy.deepcopy(self.inspection);x['releaseSha256']='0'*64
        with self.assertRaises(ValueError):binding.validate_inspection(x)

    def test_qa_started_rejected(self):
        x=copy.deepcopy(self.inspection);x['qaBefore'][0]['running']=True
        with self.assertRaises(ValueError):binding.validate_inspection(x)

    def test_remote_write_rejected(self):
        x=copy.deepcopy(self.inspection);x['remoteWrites']=True
        with self.assertRaises(ValueError):binding.validate_inspection(x)

    def test_metadata_mutation_rejected(self):
        x=copy.deepcopy(self.inspection);next(f for f in x['files'] if 'text' in f)['text']+='x'
        with self.assertRaises(ValueError):binding.validate_inspection(x)

    def test_nested_metadata_mutation_rejected(self):
        x=copy.deepcopy(self.inspection);next(f for f in x['files'] if f.get('nested'))['nested'][0]['text']+='x'
        with self.assertRaises(ValueError):binding.validate_inspection(x)

    def test_duplicate_original_rejected(self):
        x=copy.deepcopy(self.inspection);x['files'].append(x['files'][0])
        with self.assertRaises(ValueError):binding.validate_inspection(x)

    def test_wrong_image_rejected(self):
        with self.assertRaises(ValueError):binding.files_for(self.row,self.inspection,'sha256:wrong')

    def test_missing_location_not_bound(self):
        r=copy.deepcopy(self.row);r['locations'][0]['path']='/missing.jar'
        self.assertEqual(binding.files_for(r,self.inspection,self.image),[])

    def test_coordinate_is_not_scanner_module_name(self):
        files=binding.files_for(self.row,self.inspection,self.image)
        self.assertEqual(binding.candidate(self.row,files[0]),('io.grpc','grpc-core','1.65.1'))
        self.assertIn('io.grpc.internal',self.row['purl'])

    def test_version_mismatch_no_candidate(self):
        r=copy.deepcopy(self.row);r['version']='not-matching'
        f=binding.files_for(self.row,self.inspection,self.image)[0]
        self.assertIsNone(binding.candidate(r,f))

    def test_runner_not_maven_coordinate(self):
        self.assertIsNone(binding.candidate({'name':'quarkus-run','version':'26.0.8'},{'path':'opt/keycloak/lib/quarkus-run.jar'}))

    def test_unsafe_coordinates_rejected(self):
        with self.assertRaises(ValueError):binding.jar_url(('io.grpc','../oops','1'))

    def test_unsafe_upstream_url_rejected(self):
        with self.assertRaises(ValueError):binding.fetch_digest('https://attacker.example/f.jar')

    def test_nested_traversal_rejected(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('../pom.xml','x')
        with self.assertRaises(ValueError):collect.nested_metadata(out.getvalue())

    def test_nested_valid_manifest(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('META-INF/MANIFEST.MF','Manifest-Version: 1.0\n')
        self.assertEqual(len(collect.nested_metadata(out.getvalue())),1)

    def test_bsd_templates_match(self):
        for name,text in self.templates.items():self.assertEqual(bsd.match(text,self.templates),name)

    def test_bsd_clause_removed_rejected(self):
        text=self.templates['BSD-3-Clause'].replace('specific prior written permission','permission')
        self.assertIsNone(bsd.match(text,self.templates))

    def test_bsd_extra_terms_rejected(self):
        text=self.templates['BSD-2-Clause']+'\nAdditional restriction: no commercial use.'
        self.assertIsNone(bsd.match(text,self.templates))

    def test_bsd_extra_header_rejected(self):
        self.assertIsNone(bsd.match('Noncommercial only\n'+self.templates['BSD-2-Clause'],self.templates))

    def test_go_bsd_variant(self):
        text=self.templates['BSD-3-Clause'].replace('the copyright holder nor','Google LLC nor').replace('IN NO EVENT SHALL THE COPYRIGHT HOLDER','IN NO EVENT SHALL THE COPYRIGHT OWNER')
        self.assertEqual(bsd.match(text,self.templates),'BSD-3-Clause')

    def test_no_silent_clearance(self):
        summary=json.loads((bsd.OUT/'summary.json').read_text())
        q=json.loads((bsd.OUT/'review-queue.json').read_text())
        self.assertFalse(summary['engineeringComplete']);self.assertFalse(summary['stage74Accepted'])
        self.assertTrue(all(r['legalDispositionApproved'] is False for r in q))
        self.assertEqual(summary['remainingMissingMetadata'],sum(r['reviewStatus']=='licence-metadata-unresolved' for r in q))


if __name__=='__main__':unittest.main()
