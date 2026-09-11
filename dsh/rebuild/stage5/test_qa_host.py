import json,stat,sys,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parent/'qa'))
import importlib
qa_host=importlib.import_module("qa_host")

class HostScope(unittest.TestCase):
 def check(self,host='DSH2',uid=0,owner=0,mode=stat.S_IFREG|0o644,identity='machine',missing=False):
  expected={'purpose':'alica-stage5-dedicated-qa','hostname':host,'machineId':identity}
  def read(p):return 'machine\n' if str(p)=='/etc/machine-id' else json.dumps(expected)
  with patch.object(qa_host.socket,'gethostname',return_value=host),patch.object(qa_host.os,'geteuid',return_value=uid),patch.object(Path,'lstat',side_effect=FileNotFoundError if missing else None,return_value=SimpleNamespace(st_mode=mode,st_uid=owner)),patch.object(Path,'read_text',read):
   qa_host.assert_qa_host()
 def test_dedicated_host_passes(self):self.check()
 def test_legacy_guest_passes(self):self.check(host='dsh-stage5-disposable')
 def test_shared_host_denied(self):
  with self.assertRaises(RuntimeError):self.check(host='ALICA-v1')
 def test_nonroot_denied(self):
  with self.assertRaises(RuntimeError):self.check(uid=1000)
 def test_missing_marker_denied(self):
  with self.assertRaises(FileNotFoundError):self.check(missing=True)
 def test_machine_mismatch_denied(self):
  with self.assertRaises(RuntimeError):self.check(identity='foreign')
 def test_unowned_marker_denied(self):
  with self.assertRaises(RuntimeError):self.check(owner=1000)
 def test_writable_marker_denied(self):
  with self.assertRaises(RuntimeError):self.check(mode=stat.S_IFREG|0o666)
 def test_symlink_marker_denied(self):
  with self.assertRaises(RuntimeError):self.check(mode=stat.S_IFLNK|0o777)
if __name__=='__main__':unittest.main()
