import importlib.util,unittest
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('ops',Path(__file__).with_name('ops.py'));assert spec and spec.loader
ops=importlib.util.module_from_spec(spec);spec.loader.exec_module(ops)
class WaitReadiness(unittest.TestCase):
 def fixture(self,states):
  rows=[{'Config':{'Labels':{'com.docker.compose.service':n}},'State':{'Running':running,'Health':{'Status':health}}} for n,running,health in states]
  i=SimpleNamespace(release={'images':{'postgresql':{},'hermes':{}}},compose=lambda *a:'compose-success',owned=lambda:rows)
  ops.enforce_wait_readiness(i);return i
 def test_zero_exit_starting_rejected(self):
  with self.assertRaises(RuntimeError):self.fixture([('postgresql',True,'starting')]).compose('up','--wait','postgresql')
 def test_missing_stopped_unhealthy_rejected(self):
  for states in ([],[('postgresql',False,'healthy')],[('postgresql',True,'unhealthy')]):
   with self.subTest(states=states),self.assertRaises(RuntimeError):self.fixture(states).compose('up','--wait','postgresql')
 def test_healthy_subset_passes(self):self.assertEqual(self.fixture([('postgresql',True,'healthy')]).compose('up','--wait','postgresql'),'compose-success')
 def test_whole_cell_requires_all(self):
  with self.assertRaises(RuntimeError):self.fixture([('postgresql',True,'healthy')]).compose('up','--wait')
  self.assertEqual(self.fixture([('postgresql',True,'healthy'),('hermes',True,'healthy')]).compose('up','--wait'),'compose-success')
 def test_stop_not_gated(self):self.assertEqual(self.fixture([]).compose('stop'),'compose-success')
if __name__=='__main__':unittest.main()
