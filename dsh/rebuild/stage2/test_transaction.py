import json
import os
from pathlib import Path
import tempfile
import unittest
from transaction import Transaction,TransactionError

class Transactions(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name);self.root=self.base/'candidate';self.t=Transaction(self.root,{'cell':'test'},{'release':'fixture'})
 def tearDown(self):self.temp.cleanup()
 def test_plan_read_only(self):
  before=list(self.base.iterdir());self.assertEqual(self.t.inspect()['state'],'absent');self.assertEqual(list(self.base.iterdir()),before)
 def test_reject_unowned(self):
  self.root.mkdir(mode=0o700);(self.root/'existing-data').write_text('preserve');self.assertRaises(TransactionError,self.t.inspect);self.assertEqual((self.root/'existing-data').read_text(),'preserve')
 def test_success_idempotent(self):
  calls=[];self.t.execute([('prepare',lambda:calls.append(1))],lambda:None);self.t.execute([('prepare',lambda:calls.append(2))],lambda:None);self.assertEqual(calls,[1])
 def test_rollback_retains_data_then_retry(self):
  stopped=[]
  def prepare():(self.root/'data').write_text('retained')
  def fail():raise RuntimeError('private-token-do-not-log')
  with self.assertRaisesRegex(TransactionError,'candidate stopped'):self.t.execute([('prepare',prepare),('start',fail)],lambda:stopped.append(True))
  self.assertEqual(stopped,[True]);self.assertEqual((self.root/'data').read_text(),'retained');self.assertNotIn('private-token',(self.root/'transaction.json').read_text())
  self.assertEqual(self.t.execute([('prepare',lambda:None)],lambda:None)['state'],'installed')
 def test_conflicting_release_rejected(self):
  self.t.execute([],lambda:None);other=Transaction(self.root,{'cell':'test'},{'release':'other'});self.assertRaises(TransactionError,other.inspect)
 def test_parallel_writer_rejected(self):
  with self.t.locked():self.assertRaises(TransactionError,lambda:self.t.execute([],lambda:None))
 def test_symlink_rejected(self):
  self.root.symlink_to(self.base);self.assertRaises(TransactionError,lambda:Transaction(self.root,{},{}))
 def test_unsafe_permissions_rejected(self):
  self.t.execute([],lambda:None);self.root.chmod(0o755);self.assertRaises(TransactionError,self.t.inspect)
 def test_rollback_failure_truthful(self):
  def fail():raise RuntimeError('failure')
  self.assertRaises(TransactionError,lambda:self.t.execute([('fail',fail)],fail));self.assertEqual(self.t.inspect()['state'],'rollback-failed')
 def test_owner_substitution_rejected(self):
  self.t.execute([],lambda:None);(self.root/'owner.json').unlink();(self.root/'owner.json').symlink_to(self.base/'outside');self.assertRaises(TransactionError,self.t.inspect)
if __name__=='__main__':unittest.main()
