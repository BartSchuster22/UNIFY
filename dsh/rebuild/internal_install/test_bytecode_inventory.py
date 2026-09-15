import os,subprocess,sys,tempfile,unittest
from pathlib import Path

class BundleBytecodeTests(unittest.TestCase):
 def check_import(self,child):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'fixture_module.py').write_text('VALUE=1\n')
   setup=Path(__file__).with_name('setup.py')
   code='import importlib.util,sys,subprocess; s=importlib.util.spec_from_file_location("trusted_setup",'+repr(str(setup))+'); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
   inner='import sys;sys.path.insert(0,'+repr(tmp)+');import fixture_module;assert fixture_module.VALUE==1'
   code+=('subprocess.run([sys.executable,"-c",'+repr(inner)+'],check=True)' if child else inner)
   env=dict(os.environ);env.pop('PYTHONDONTWRITEBYTECODE',None)
   subprocess.run([sys.executable,'-I','-c',code],env=env,check=True,capture_output=True)
   self.assertFalse((p/'__pycache__').exists())
 def test_isolated_bootstrap_import_does_not_mutate_bundle(self):self.check_import(False)
 def test_lifecycle_child_does_not_mutate_bundle(self):self.check_import(True)
