import copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('maintenance_tested',HERE/'maintenance.py');M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
class MaintenanceTests(unittest.TestCase):
 def fixture(self):
  files={f:'a'*64 for f in ['install.py','transaction.py','ops.py','render.py','frameworks.json','compose.template.json','doghouse-dsh.tar','tls_lifecycle.py','recover_owner.py']}
  old={'schema':'dsh-stage2-bundle/v1','images':{s:{'id':'sha256:'+'a'*64} for s in M.SERVICES},'files':files}
  new=copy.deepcopy(old)
  for s in M.CHANGED:new['images'][s]['id']='sha256:'+'b'*64
  new['maintenance']={'schema':'dsh-internal-maintenance/v1','cell':M.CELL,'predecessorReleaseSha256':M.OLD_SHA,'preserveIdentities':True,'licensingReviewResumed':False,'sourceRevision':'c'*40}
  owner={'schema':'dsh-stage2-owner/v1','request':'q','release':hashlib.sha256(json.dumps(old,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
  return old,new,owner
 def test_exact_transition(self):M.validate_transition(*self.fixture(),'q')
 def test_denies_foreign_predecessor(self):
  o,n,w=self.fixture();n['maintenance']['predecessorReleaseSha256']='d'*64
  with self.assertRaises(RuntimeError):M.validate_transition(o,n,w,'q')
 def test_denies_owner_adoption(self):
  o,n,w=self.fixture();w['request']='someone else'
  with self.assertRaises(RuntimeError):M.validate_transition(o,n,w,'q')
 def test_denies_other_runtime_changes(self):
  o,n,w=self.fixture();n['images']['memory-v4']['id']='sha256:'+'f'*64
  with self.assertRaises(RuntimeError):M.validate_transition(o,n,w,'q')
 def test_denies_ownership_code_change(self):
  o,n,w=self.fixture();n['files']['transaction.py']='changed'
  with self.assertRaises(RuntimeError):M.validate_transition(o,n,w,'q')
 def test_denies_licensing_scope(self):
  o,n,w=self.fixture();n['maintenance']['licensingReviewResumed']=True
  with self.assertRaises(RuntimeError):M.validate_transition(o,n,w,'q')
 def test_ingress_limit_is_route_scoped(self):
  old='https://example.test {\n route {\n request_body {\n max_size 1MB\n }\n respond 200\n }\n}'
  updated=M.upgrade_caddy(old);self.assertIn('request_body @workspaceUploads',updated);self.assertIn('request_body @otherRequests',updated);self.assertIn('max_size 1MB',updated)
  self.assertNotIn('DSH maintenance',updated);self.assertIn('respond "DSH maintenance; retry shortly" 503',M.upgrade_caddy(old,True))
 def test_ingress_shape_change_denied(self):
  with self.assertRaises(RuntimeError):M.upgrade_caddy('unexpected configuration')
 def test_cold_tree_detects_contents_modes_and_links(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'file').write_text('one');first=M.tree(p);(p/'file').write_text('two');self.assertNotEqual(first,M.tree(p));second=M.tree(p);(p/'file').chmod(0o600);self.assertNotEqual(second,M.tree(p));(p/'link').symlink_to('/not-read');self.assertIsInstance(M.tree(p),str)
 def test_atomic_write_preserves_old_on_collision(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'state';p.write_bytes(b'old');p.with_name('state.maintenance-new').write_bytes(b'other')
   with self.assertRaises(FileExistsError):M.write(p,b'new',0o600)
   self.assertEqual(p.read_bytes(),b'old')
 def test_failed_candidate_not_restored_after_commit(self):
  with patch.object(M,'load',return_value={'phase':'committed'}):self.assertEqual(M.recover({}),{'phase':'committed','changed':False})
 def test_interrupted_checkpoint_restarts_unchanged_installation(self):
  from unittest.mock import Mock
  old=Mock()
  with patch.object(M,'load',return_value={'phase':'quiesced'}),patch.object(M,'healthy'),patch.object(M,'finish'),patch.object(M,'checkpoint'):
   self.assertEqual(M.recover({'old_i':old})['phase'],'backup-failed-old-running')
   old.tx.inspect.assert_called_once();old.compose.assert_called_once()
 def test_health_uses_installed_inspection_interface(self):
  from types import SimpleNamespace
  rows=[{'Config':{'Labels':{'com.docker.compose.service':s}},'Image':s,'State':{'Running':True,'Health':{'Status':'healthy'}}} for s in M.SERVICES]
  installer=SimpleNamespace(owned=lambda:rows,release={'images':{s:{'id':s} for s in M.SERVICES}})
  M.healthy(installer)
  rows[0]['State']['Health']['Status']='unhealthy'
  with self.assertRaises(RuntimeError):M.healthy(installer)
 def test_recovery_refuses_incomplete_checkpoint(self):
  with patch.object(M,'load',return_value={'phase':'identity-transitioned'}):
   with self.assertRaises(RuntimeError):M.recover({})
if __name__=='__main__':unittest.main()
