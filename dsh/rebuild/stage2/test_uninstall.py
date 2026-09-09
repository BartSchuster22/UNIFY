import contextlib,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from install import Installer
from transaction import TransactionError,atomic_json
class Uninstall(unittest.TestCase):
 def fixture(self,foreign=False,lose=False):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);root=Path(temp.name);(root/'compose.json').write_text('{}');(root/'payload').write_text('retain me');journal=root/'transaction.json';atomic_json(journal,{'state':'installed','completed':['fixture']})
  i=object.__new__(Installer);i.root=root;i.r={'cell':'dsh2-test'};i.operator=lambda:None;i.prepare=lambda:None;i.records=lambda:[];i.owned=lambda:[];state={'down':False,'calls':[]}
  i.tx=SimpleNamespace(journal=journal,inspect=lambda:json.loads(journal.read_text()),locked=contextlib.nullcontext)
  def docker(kind,action,*args):
   if action=='ls':return '' if (kind=='network' and state['down']) or (kind=='volume' and lose and state['down']) else 'owned-'+kind
   return json.dumps([{'Name':'owned-'+kind,'Labels':{'com.alica.stage2':'foreign' if foreign else 'dsh2-test'}}])
  def compose(*args):state['calls'].append(args);state['down']=True
  i.docker=docker;i.compose=compose;return i,state
 def test_retains_data_and_journals_uninstall(self):
  i,state=self.fixture();result=i.uninstall();self.assertTrue(result['data_retained']);self.assertEqual(result['retained_volume_count'],1);self.assertEqual(state['calls'],[('down','--timeout','30')]);self.assertEqual((i.root/'payload').read_text(),'retain me');self.assertEqual(i.tx.inspect()['state'],'uninstalled-data-retained')
 def test_foreign_resources_fail_before_removal(self):
  i,state=self.fixture(foreign=True)
  with self.assertRaises(TransactionError):i.uninstall()
  self.assertFalse(state['calls'])
 def test_retention_failure_is_not_success(self):
  i,state=self.fixture(lose=True)
  with self.assertRaises(TransactionError):i.uninstall()
  self.assertNotEqual(i.tx.inspect()['state'],'uninstalled-data-retained')
