import io,json,tarfile,tempfile,unittest
from pathlib import Path
import build_clean_candidate as b
class CleanCandidateTests(unittest.TestCase):
    def archive(self,p,entries):
        with tarfile.open(p,'w') as t:
            for n,kind,value in entries:
                m=tarfile.TarInfo(n);m.mode=0o755;m.uid=123;m.gid=456;m.type=kind
                if kind==tarfile.REGTYPE:m.size=len(value);t.addfile(m,io.BytesIO(value))
                else:m.linkname=value;t.addfile(m)
    def test_snapshot_ignores_only_order(self):
        a=[{'Id':'b','Mounts':[{'Destination':'/b'},{'Destination':'/a'}],'State':{'Running':False}},{'Id':'a','Mounts':[]}]
        c=[{'Id':'a','Mounts':[]},{'Id':'b','Mounts':[{'Destination':'/a'},{'Destination':'/b'}],'State':{'Running':False}}]
        self.assertEqual(b.canonical_snapshot(a),b.canonical_snapshot(c));c[1]['State']['Running']=True
        self.assertNotEqual(b.canonical_snapshot(a),b.canonical_snapshot(c));self.assertEqual(a[0]['Mounts'][0]['Destination'],'/b')
    def test_scope(self):
        for p in ['root/.cache/uv/a','root/.cache/pip/a','root/.npm/a','opt/hermes/plugins/platforms/photon/__init__.py','a/FOO.DLL','a/x.exe','a/x.pyd']:self.assertIsNotNone(b.removed(p),p)
        for p in ['root/.cache/ms-playwright/chrome','root/.cache/uv-extra/a','opt/hermes/plugins/platforms/telegram/a','app/data','a/libssl.so']:self.assertIsNone(b.removed(p),p)
    def test_retained_hardlink_to_removed_cache(self):
        with tempfile.TemporaryDirectory() as d:
            a=Path(d)/'in.tar';out=Path(d)/'out.tar'
            self.archive(a,[('root/.cache/uv/x',tarfile.REGTYPE,b'actual fixture payload'),('opt/hermes/lib/x',tarfile.LNKTYPE,'root/.cache/uv/x'),('other.dll',tarfile.REGTYPE,b'MZ fixture')])
            r=b.clean_tar(a,out);self.assertEqual(len(r['removed']),2);self.assertEqual(len(r['materializedHardlinks']),1)
            with tarfile.open(out) as t:
                m=t.getmember('opt/hermes/lib/x');self.assertTrue(m.isfile());self.assertEqual(t.extractfile(m).read(),b'actual fixture payload');self.assertEqual((m.mode,m.uid,m.gid),(0o755,123,456))
    def test_reject_symlink_to_cache(self):
        with tempfile.TemporaryDirectory() as d:
            a=Path(d)/'a';self.archive(a,[('app/lib',tarfile.SYMTYPE,'/root/.cache/uv/a')])
            with self.assertRaises(ValueError):b.clean_tar(a,Path(d)/'b')
    def test_no_replace(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a';p.touch()
            with self.assertRaises(ValueError):b.clean_tar(p,p)
    def test_unsafe_and_duplicate(self):
        for names in [['../escape'],['/absolute'],['x','./x'],['a/.wh.foo']]:
            with self.subTest(names=names),tempfile.TemporaryDirectory() as d:
                a=Path(d)/'a';self.archive(a,[(n,tarfile.REGTYPE,b'x') for n in names])
                with self.assertRaises(ValueError):b.clean_tar(a,Path(d)/'b')
    def test_deterministic_layer(self):
        with tempfile.TemporaryDirectory() as d:
            a=Path(d)/'a';self.archive(a,[('bin/app',tarfile.REGTYPE,b'executable fixture')]);b.clean_tar(a,Path(d)/'b');b.clean_tar(a,Path(d)/'c');self.assertEqual(b.sha(Path(d)/'b'),b.sha(Path(d)/'c'))
    def test_config_and_single_layer(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);self.archive(p/'layer',[('bin/app',tarfile.REGTYPE,b'fixture')]);config={'os':'linux','architecture':'amd64','config':{'User':'123','Entrypoint':['/app'],'Env':['A=B'],'Volumes':{'/data':{}},'Healthcheck':{'Test':['CMD','true']}},'rootfs':{'type':'layers','diff_ids':['sha256:old']}}
            image=b.image_archive(config,p/'layer',p/'image','test:fixture')
            with tarfile.open(p/'image') as t:
                m=json.load(t.extractfile('manifest.json'))[0];c=json.load(t.extractfile(m['Config']));self.assertEqual(c['config'],config['config']);self.assertEqual(len(m['Layers']),1);self.assertEqual(image,'sha256:'+m['Config'].removesuffix('.json'))
            self.assertEqual(config['rootfs']['diff_ids'],['sha256:old'])
if __name__=='__main__':unittest.main()
