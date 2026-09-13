import base64,copy,hashlib,json,unittest
from pathlib import Path
import bind_package_context as binding
import bind_distlib as distlib
import match_document_formats as formats
import build_engineering_evidence as engineering

class ContextTests(unittest.TestCase):
    def test_record_hash_size(self):
        b=b'launcher';h=hashlib.sha256(b).hexdigest();encoded=base64.urlsafe_b64encode(bytes.fromhex(h)).decode().rstrip('=');r={'sha256':h,'bytes':len(b)}
        self.assertTrue(binding.record_contains('file,sha256='+encoded+',8\n','file',r))
    def test_record_wrong_hash(self):
        self.assertFalse(binding.record_contains('file,sha256=abcd,8\n','file',{'sha256':'0'*64,'bytes':8}))
    def test_record_wrong_size(self):
        h='0'*64;e=base64.urlsafe_b64encode(bytes.fromhex(h)).decode().rstrip('=')
        self.assertFalse(binding.record_contains('file,sha256='+e+',9\n','file',{'sha256':h,'bytes':8}))
    def test_record_duplicate(self):
        self.assertFalse(binding.record_contains('file,,\nfile,,\n','file',{'sha256':'0'*64,'bytes':8}))
    def test_record_missing(self):self.assertFalse(binding.record_contains('other,,\n','file',{}))
    def test_record_malformed(self):
        with self.assertRaises(ValueError):binding.record_contains('x,a\n','file',{})
    def test_workspace_explicit(self):self.assertTrue(binding.workspace_match('apps/shared','apps/*'))
    def test_workspace_not_recursive(self):self.assertFalse(binding.workspace_match('apps/shared/node_modules/a','apps/*'))
    def test_workspace_sibling(self):self.assertFalse(binding.workspace_match('apps2/shared','apps/*'))
    def test_workspace_negative(self):self.assertFalse(binding.workspace_match('apps/shared','!apps/*'))
    def fixture(self,workspaces=['apps/*'],path='root/apps/a/package.json'):
        child={'layer':'l','path':path,'regular':True,'text':json.dumps({'name':'a','version':'1'}),'sha256':'child'}
        parent={'layer':'l','path':'root/package.json','regular':True,'text':json.dumps({'name':'root','version':'1','license':'MIT','workspaces':workspaces}),'sha256':'parent'}
        c={'images':{'i':['l']},'links':{'l':[]},'whiteouts':{'l':[]}}
        index={('l',r['path']):r for r in [child,parent]}
        row={'name':'a','version':'1'};loc={'path':path,'layerID':'l'}
        return row,loc,c,index
    def test_npm_workspace(self):
        args=self.fixture();r=binding.npm_owner(*args,'i');self.assertEqual(r['declaredLicence'],'MIT');self.assertFalse(r['isChildStandaloneLicenceDeclaration'])
    def test_npm_excluded(self):self.assertIsNone(binding.npm_owner(*self.fixture(['apps/*','!apps/a']),'i'))
    def test_npm_no_workspace(self):self.assertIsNone(binding.npm_owner(*self.fixture([]),'i'))
    def test_npm_does_not_borrow_application_licence(self):self.assertIsNone(binding.npm_owner(*self.fixture(['node_modules/*'],path='root/node_modules/a/package.json'),'i'))
    def test_npm_own_licence_not_overridden(self):
        row,loc,c,index=self.fixture();index[('l',loc['path'])]['text']=json.dumps({'name':'a','version':'1','license':'Other'})
        self.assertIsNone(binding.npm_owner(row,loc,c,index,'i'))
    def test_npm_wrong_version(self):
        row,loc,c,index=self.fixture();row['version']='2';self.assertIsNone(binding.npm_owner(row,loc,c,index,'i'))
    def test_whiteout(self):
        c={'images':{'i':['a','b']},'links':{},'whiteouts':{'b':['root/.wh.file']}}
        self.assertIsNone(binding.resolve(c,{('a','root/file'):{'regular':True}},'i','root/file',1))
    def test_opaque(self):
        c={'images':{'i':['a','b']},'links':{},'whiteouts':{'b':['root/.wh..wh..opq']}}
        self.assertIsNone(binding.resolve(c,{('a','root/file'):{'regular':True}},'i','root/file',1))
    def test_hardlink(self):
        c={'images':{'i':['a']},'links':{'a':[{'path':'root/link','target':'root/file','hardlink':True}]},'whiteouts':{}}
        r={'regular':True,'sha256':'x'};self.assertEqual(binding.resolve(c,{('a','root/file'):r},'i','root/link',0),r)
    def test_link_loop(self):
        c={'images':{'i':['a']},'links':{'a':[{'path':'x','target':'x','hardlink':True}]},'whiteouts':{}}
        self.assertIsNone(binding.resolve(c,{},'i','x',0))
    def test_path_escape(self):
        with self.assertRaises(ValueError):binding.norm('../../host')
    def test_distlib_wrong_version(self):
        with self.assertRaises(ValueError):distlib.wheel_manifest({'info':{'name':'distlib','version':'0.3.10','license':'PSF-2.0'}})
    def test_distlib_untrusted_url(self):
        with self.assertRaises(ValueError):distlib.fetch('https://pypi.org.attacker.invalid/file')

class FormatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        b=Path(__file__).parent;r=json.loads((b/'go-text-review/report.json').read_text())['templates']['Apache-2.0'];cls.template=(b/'go-text-review/objects'/r['sha256']).read_text()
    def test_exact(self):self.assertEqual(formats.apache(self.template,self.template),'Apache-2.0')
    def test_no_appendix(self):self.assertEqual(formats.apache(self.template.split('END OF TERMS AND CONDITIONS')[0],self.template),'Apache-2.0')
    def test_copyright_substitution(self):self.assertEqual(formats.apache(self.template.replace('Copyright [yyyy] [name of copyright owner]','Copyright 2020 Example Inc.'),self.template),'Apache-2.0')
    def test_extra_terms(self):self.assertIsNone(formats.apache(self.template+'\nNoncommercial use only.',self.template))
    def test_body_change(self):self.assertIsNone(formats.apache(self.template.replace('perpetual','temporary'),self.template))
    def test_prefix_restriction(self):self.assertIsNone(formats.apache('Noncommercial use only.\n'+self.template,self.template))
    def test_nested_licence(self):self.assertIsNone(formats.apache(self.template+'\nBSD 3-Clause License\nRedistribution ...',self.template))

class GateTests(unittest.TestCase):
    def checks(self):return {'identity':'verified','metadata':'verified','noticeDelivery':'unresolved','correspondingSource':'unresolved','buildInstructions':'unresolved','relinkMaterials':'unresolved'}
    def test_metadata_not_completion(self):self.assertFalse(engineering.gate([{'engineeringChecks':self.checks()}]))
    def test_empty_not_completion(self):self.assertFalse(engineering.gate([]))
    def test_missing_dimension(self):
        c=self.checks();del c['relinkMaterials']
        with self.assertRaises(ValueError):engineering.gate([{'engineeringChecks':c}])
    def test_no_unsupported_na(self):
        c=self.checks();c['relinkMaterials']='not-required-with-evidence'
        with self.assertRaises(ValueError):engineering.gate([{'engineeringChecks':c}])
    def test_foreign_layer_notice(self):
        row={'type':'python','locations':[{'path':'p/x.dist-info/METADATA','layerID':'a'}]}
        self.assertIsNone(engineering.relation(row,{'path':'p/x.dist-info/LICENSE','layer':'b'}))
    def test_sibling_notice(self):
        row={'type':'python','locations':[{'path':'p/x.dist-info/METADATA','layerID':'a'}]}
        self.assertIsNone(engineering.relation(row,{'path':'p/y.dist-info/LICENSE','layer':'a'}))
    def test_package_notice(self):
        row={'type':'python','locations':[{'path':'p/x.dist-info/METADATA','layerID':'a'}]}
        self.assertEqual(engineering.relation(row,{'path':'p/x.dist-info/LICENSE','layer':'a'}),'same-distribution-directory-and-layer')

class MitDispositionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        b=Path(__file__).parent;r=json.loads((b/'go-text-review/report.json').read_text())['templates']['MIT'];cls.text=(b/'go-text-review/objects'/r['sha256']).read_bytes()
    def refs(self):return [{'path':'pkg/LICENSE','relation':'same-package-root-and-layer','sha256':'h','layer':'l'}]
    def test_missing_layer_blocks(self):
        self.assertIsNone(engineering.bounded_mit_disposition({'type':'npm','declaredLicenses':['MIT'],'locations':[{'layerID':'other'}]},self.refs(),{'h':self.text}))
    def test_bounded_mit(self):
        d=engineering.bounded_mit_disposition({'type':'npm','declaredLicenses':['MIT'],'locations':[{'layerID':'l'}]},self.refs(),{'h':self.text})
        self.assertIsNotNone(d);self.assertFalse(d['legalDispositionApproved'])
    def test_mixed_licence_not_selected(self):
        self.assertIsNone(engineering.bounded_mit_disposition({'type':'npm','declaredLicenses':['MIT','GPL-3.0-only']},self.refs(),{'h':self.text}))
    def test_missing_notice(self):
        self.assertIsNone(engineering.bounded_mit_disposition({'type':'npm','declaredLicenses':['MIT'],'locations':[{'layerID':'l'}]},[],{}))
    def test_additional_local_licence_blocks(self):
        refs=self.refs()+[{'path':'pkg/LICENSE.EXTRA','relation':'same-package-root-and-layer','sha256':'x'}]
        self.assertIsNone(engineering.bounded_mit_disposition({'type':'npm','declaredLicenses':['MIT'],'locations':[{'layerID':'l'}]},refs,{'h':self.text,'x':b'Commercial use prohibited.'}))
    def test_extra_terms_blocks(self):
        self.assertIsNone(engineering.bounded_mit_disposition({'type':'npm','declaredLicenses':['MIT'],'locations':[{'layerID':'l'}]},self.refs(),{'h':self.text+b'\nCommercial use prohibited.'}))
    def test_binary_not_inferred(self):
        self.assertIsNone(engineering.bounded_mit_disposition({'type':'binary','declaredLicenses':['MIT'],'locations':[{'layerID':'l'}]},self.refs(),{'h':self.text}))

class OriginTests(unittest.TestCase):
    def info(self):return {'Version':'v0.27.0','Origin':{'VCS':'git','URL':'https://go.googlesource.com/text','Hash':'a'*40,'Ref':'refs/tags/v0.27.0'}}
    def test_bound_origin(self):
        import collect_go_origin as o
        self.assertEqual(o.origin(self.info(),'golang.org/x/text'),'a'*40)
    def test_wrong_version(self):
        import collect_go_origin as o
        r=self.info();r['Version']='v0.26.0'
        with self.assertRaises(ValueError):o.origin(r,'golang.org/x/text')
    def test_wrong_repository(self):
        import collect_go_origin as o
        r=self.info();r['Origin']['URL']='https://example.org/text'
        with self.assertRaises(ValueError):o.origin(r,'golang.org/x/text')
    def test_unsafe_commit(self):
        import collect_go_origin as o
        r=self.info();r['Origin']['Hash']='../main'
        with self.assertRaises(ValueError):o.origin(r,'golang.org/x/text')
    def test_unsafe_url(self):
        import collect_go_origin as o
        with self.assertRaises(ValueError):o.fetch('https://raw.githubusercontent.com.evil.invalid/license')
    def test_bad_encoding(self):
        import collect_go_origin as o
        with self.assertRaises(ValueError):o.decode('golang.org/x/text',b'not base64!')

class EngineeringReplayTests(unittest.TestCase):
    def test_edited_completion_flag_rejected(self):
        import tempfile,shutil
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)/'evidence';shutil.copytree(engineering.OUT,out)
            report=json.loads((out/'summary.json').read_bytes());report['engineeringComplete']=True
            (out/'summary.json').write_text(json.dumps(report))
            with patch.object(engineering,'OUT',out),patch('sys.argv',['build_engineering_evidence.py','--verify']):
                with self.assertRaisesRegex(ValueError,'Changed engineering artifact'):
                    engineering.main()

if __name__=='__main__':unittest.main()
