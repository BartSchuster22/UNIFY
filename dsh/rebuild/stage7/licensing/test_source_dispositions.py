import io,json,tarfile,unittest
from pathlib import Path
import build_source_dispositions as source

class ExpressionTests(unittest.TestCase):
    def test_single(self):self.assertTrue(source.mit_alternative('MIT'))
    def test_explicit_or(self):self.assertTrue(source.mit_alternative('Apache-2.0 OR MIT'))
    def test_no_slash_inference(self):self.assertFalse(source.mit_alternative('MIT/Apache-2.0'))
    def test_no_and_conversion(self):self.assertFalse(source.mit_alternative('MIT AND GPL-3.0-only'))
    def test_no_with_exception(self):self.assertFalse(source.mit_alternative('MIT WITH other-exception'))
    def test_parentheses_not_guessed(self):self.assertFalse(source.mit_alternative('(MIT OR Apache-2.0) AND GPL-3.0-only'))
    def test_missing(self):self.assertFalse(source.mit_alternative(None))
    def test_identifier_substring(self):self.assertFalse(source.mit_alternative('MIT-0'))

class ArchiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        b=Path(__file__).parent
        cls.templates={n:(b/'go-text-review/objects'/r['sha256']).read_text() for n,r in json.loads((b/'go-text-review/report.json').read_bytes())['templates'].items()}
    def fixture(self,expression='MIT',extra=None,registry_expression=None,duplicate=False):
        prefix='example-1.0.0/';members={'Cargo.toml':('[package]\nname="example"\nversion="1.0.0"\nlicense="'+expression+'"\n').encode(),'LICENSE-MIT':self.templates['MIT'].encode()}
        members.update(extra or {});stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w:gz') as t:
            for n,b in members.items():
                m=tarfile.TarInfo(prefix+n);m.size=len(b);t.addfile(m,io.BytesIO(b))
            if duplicate:
                b=b'x';m=tarfile.TarInfo(prefix+'LICENSE-MIT');m.size=1;t.addfile(m,io.BytesIO(b))
        raw=stream.getvalue();registry=json.dumps({'version':{'crate':'example','num':'1.0.0','checksum':source.sha(raw),'license':registry_expression or expression}}).encode()
        notices=[{'path':prefix+n,'sha256':source.sha(b),'bytes':len(b)} for n,b in members.items() if n!='Cargo.toml']
        row={'crateSha256':source.sha(raw),'metadataSha256':source.sha(registry),'name':'example','version':'1.0.0','cargoDeclaredLicense':expression,'declaredRegistryLicense':registry_expression or expression,'noticeCandidates':notices}
        return raw,registry,row
    def inspect(self,*args,**kwargs):return source.inspect_crate(*self.fixture(*args,**kwargs),self.templates)
    def test_actual_source_notice_delivered(self):
        notices,texts,d=self.inspect();self.assertEqual(d['selectedAlternative'],'MIT');self.assertEqual(texts[notices[0]['sha256']],self.templates['MIT'].encode());self.assertFalse(d['legalDispositionApproved'])
    def test_explicit_or_records_choice(self):
        _,_,d=self.inspect('MIT OR Apache-2.0',{'LICENSE-APACHE':self.templates['Apache-2.0'].encode()});self.assertEqual(d['upstreamExpression'],'MIT OR Apache-2.0');self.assertEqual(d['selectedAlternative'],'MIT')
    def test_and_not_closed(self):self.assertIsNone(self.inspect('MIT AND Apache-2.0')[2])
    def test_slash_not_closed(self):self.assertIsNone(self.inspect('MIT/Apache-2.0')[2])
    def test_nested_third_party_not_closed(self):self.assertIsNone(self.inspect(extra={'vendor/LICENSE':b'GPL terms'})[2])
    def test_additional_root_terms_not_closed(self):self.assertIsNone(self.inspect(extra={'LICENSE-EXTRA':b'Commercial use prohibited'})[2])
    def test_conflicting_registry_not_closed(self):self.assertIsNone(self.inspect(registry_expression='Apache-2.0')[2])
    def test_changed_source_rejected(self):
        raw,registry,r=self.fixture()
        with self.assertRaises(ValueError):source.inspect_crate(raw+b'x',registry,r,self.templates)
    def test_changed_registry_rejected(self):
        raw,registry,r=self.fixture()
        with self.assertRaises(ValueError):source.inspect_crate(raw,registry+b'x',r,self.templates)
    def test_omitted_notice_rejected(self):
        raw,registry,r=self.fixture();r['noticeCandidates']=[]
        with self.assertRaises(ValueError):source.inspect_crate(raw,registry,r,self.templates)
    def test_unsafe_path_rejected(self):
        raw,registry,r=self.fixture(extra={'../LICENSE':b'x'})
        with self.assertRaises(ValueError):source.inspect_crate(raw,registry,r,self.templates)
    def test_duplicate_path_rejected(self):
        with self.assertRaises(ValueError):self.inspect(duplicate=True)
    def gate_row(self):
        d=self.inspect()[2]
        return {'type':'rust-crate','engineeringDisposition':d,'engineeringChecks':{'identity':'verified','metadata':'verified','noticeDelivery':'verified','correspondingSource':'not-required-with-evidence','buildInstructions':'not-required-with-evidence','relinkMaterials':'not-required-with-evidence'}}
    def test_scoped_positive_gate(self):self.assertTrue(source.complete([self.gate_row()]))
    def test_no_identity_exemption(self):
        r=self.gate_row();r['engineeringChecks']['identity']='not-required-with-evidence'
        with self.assertRaises(ValueError):source.complete([r])
    def test_no_binary_scope_expansion(self):
        r=self.gate_row();r['type']='binary'
        with self.assertRaises(ValueError):source.complete([r])
    def test_no_empty_source_hash(self):
        r=self.gate_row();r['engineeringDisposition']['crateSha256']=''
        with self.assertRaises(ValueError):source.complete([r])
    def test_no_empty_completion(self):self.assertFalse(source.complete([]))

if __name__=='__main__':unittest.main()
