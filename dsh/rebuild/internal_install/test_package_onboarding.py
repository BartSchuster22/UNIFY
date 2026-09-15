"""Tiny Docker-export fixtures exercise verification, not real runtime acceptance."""
import gzip,hashlib,io,json,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import package_onboarding as p

def sha(b):return 'sha256:'+hashlib.sha256(b).hexdigest()

class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.path=self.root/'images.tar'
    def tearDown(self):self.tmp.cleanup()
    def fixture(self,compressed=False,bad_diff=False,extra=False,link=False,duplicate=False):
        raw=b'fixture layer bytes, not a real runtime image'
        layer=gzip.compress(raw,mtime=0) if compressed else raw
        config={'rootfs':{'type':'layers','diff_ids':[sha(b'wrong') if bad_diff else sha(raw)]},'os':'linux','architecture':'amd64'}
        cb=p.canonical(config);cid=sha(cb)
        members={'config.json':cb,'layer.tar':layer,'manifest.json':json.dumps([{'Config':'config.json','Layers':['layer.tar'],'RepoTags':None}]).encode()}
        if extra:
            other={**config,'created':'fixture-only-other-image'};ob=p.canonical(other)
            members['other.json']=ob
            rows=json.loads(members['manifest.json']);rows.append({'Config':'other.json','Layers':['layer.tar']});members['manifest.json']=json.dumps(rows).encode()
        with tarfile.open(self.path,'w') as t:
            for name,data in members.items():
                m=tarfile.TarInfo(name);m.size=len(data);t.addfile(m,io.BytesIO(data))
            if link:
                m=tarfile.TarInfo('unsafe');m.type=tarfile.SYMTYPE;m.linkname='/etc/passwd';t.addfile(m)
            if duplicate:
                data=members['config.json'];m=tarfile.TarInfo('config.json');m.size=len(data);t.addfile(m,io.BytesIO(data))
        return cid
    def test_uncompressed_layers_and_oci_identity(self):
        cid=self.fixture();r=p.inspect_export(self.path,{'hermes':cid})['hermes']
        self.assertEqual(r['manifest']['config']['digest'],cid)
        self.assertEqual(r['manifest']['layers'][0]['digest'],r['diff_ids'][0])
        self.assertTrue(r['manifest']['layers'][0]['mediaType'].endswith('.tar'))
    def test_compressed_layers_verified_uncompressed(self):
        cid=self.fixture(compressed=True);r=p.inspect_export(self.path,{'hermes':cid})['hermes']
        self.assertNotEqual(r['manifest']['layers'][0]['digest'],r['diff_ids'][0])
        self.assertTrue(r['manifest']['layers'][0]['mediaType'].endswith('+gzip'))
    def test_wrong_diffid_denied(self):
        cid=self.fixture(bad_diff=True)
        with self.assertRaisesRegex(AssertionError,'diffID'):p.inspect_export(self.path,{'hermes':cid})
    def test_wrong_config_denied(self):
        self.fixture()
        with self.assertRaisesRegex(AssertionError,'exactly'):p.inspect_export(self.path,{'hermes':'sha256:'+'0'*64})
    def test_extra_image_denied(self):
        cid=self.fixture(extra=True)
        with self.assertRaisesRegex(AssertionError,'exactly'):p.inspect_export(self.path,{'hermes':cid})
    def test_symlink_denied(self):
        cid=self.fixture(link=True)
        with self.assertRaisesRegex(AssertionError,'Special/link'):p.inspect_export(self.path,{'hermes':cid})
    def test_duplicate_member_denied(self):
        cid=self.fixture(duplicate=True)
        with self.assertRaisesRegex(AssertionError,'Duplicate'):p.inspect_export(self.path,{'hermes':cid})
    def test_archive_budget_denies_before_write(self):
        with (self.root/'out').open('wb') as f:
            w=p.GuardedWriter(f,0,2)
            with self.assertRaisesRegex(AssertionError,'size budget'):w.write(b'123')
            self.assertEqual(f.tell(),0)
    def test_disk_reserve_denies_before_write(self):
        with (self.root/'out').open('wb') as f:
            w=p.GuardedWriter(f,100,1000)
            with patch.object(p.shutil,'disk_usage') as usage:
                usage.return_value.free=102
                with self.assertRaisesRegex(AssertionError,'reserve'):w.write(b'123')
            self.assertEqual(f.tell(),0)
    def test_budgeted_writer_success(self):
        with (self.root/'out').open('wb') as f:
            w=p.GuardedWriter(f,0,100)
            self.assertEqual(w.write(b'123'),3);w.flush();self.assertEqual(w.tell(),3)
    def test_source_assembly_inputs_exist_and_compile(self):
        repo=Path(p.__file__).resolve().parents[3]
        import importlib.util
        spec=importlib.util.spec_from_file_location('stage7_package',repo/'dsh/rebuild/stage7/package.py');assert spec is not None and spec.loader is not None
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        for name in ['recover_owner.py','render.py','tls_lifecycle.py','transaction.py']:
            src=(repo/'dsh/rebuild/stage2'/name).read_text();compile(src,name,'exec')
        compile(m.fix_installer((repo/'dsh/rebuild/stage2/install.py').read_text()),'install.py','exec')
        compile(m.fix_operations((repo/'dsh/rebuild/stage5/ops.py').read_text()),'ops.py','exec')

if __name__=='__main__':unittest.main()
