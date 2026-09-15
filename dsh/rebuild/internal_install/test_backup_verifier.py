import importlib.util,io,os,tarfile,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).parent

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
M=load('maintenance_backup_model',HERE/'maintenance.py')
B=load('maintenance_backup_verifier',HERE.parents[2]/'scripts/backup-dsh-maintenance.py')
class BackupVerificationTests(unittest.TestCase):
 def test_actual_files_permissions_symlinks_and_hardlinks(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)/'root';root.mkdir(mode=0o700);(root/'private').write_bytes(b'non-secret fixture');(root/'private').chmod(0o600)
   os.link(root/'private',root/'hard');(root/'symbolic').symlink_to('/not-followed')
   buf=io.BytesIO()
   with tarfile.open(fileobj=buf,mode='w') as t:t.add(root,arcname='checkpoint/root')
   buf.seek(0);expected={'root':M.tree(root)};self.assertEqual(B.verify_archive(buf,expected),expected)
   buf.seek(0)
   with self.assertRaises(RuntimeError):B.verify_archive(buf,{'root':'tampered'})
 def test_path_escape_denied(self):
  buf=io.BytesIO()
  with tarfile.open(fileobj=buf,mode='w') as t:
   info=tarfile.TarInfo('checkpoint/root/../../outside');info.size=1;t.addfile(info,io.BytesIO(b'x'))
  buf.seek(0)
  with self.assertRaises(RuntimeError):B.verify_archive(buf,{'root':'unused'})
if __name__=='__main__':unittest.main()
