import importlib.util,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('maintenance_setup_tested',Path(__file__).with_name('setup.py'));S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
class AdmissionTests(unittest.TestCase):
 def exercise(self,bad=None):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);prior=p/'prior';prior.mkdir();current=p/'current';current.mkdir()
   old={'schema':'alica-user-preparation/v1','prepared':True,'scope':'qa','verifier':'/trusted/verifier','verifierSha256':'v','trust':'/trusted/keys','trustSha256':'t'}
   (prior/'preparation.json').write_text(json.dumps(old))
   state={**old,'maintenanceAdmission':{'predecessorDestination':str(prior),'releaseSha256':'a'*64,'sequence':1}}
   if bad:bad(state,old,prior)
   replies=[SimpleNamespace(returncode=0,stdout=json.dumps({'signatureVerified':True,'releaseSha256':'a'*64,'sequence':1})),SimpleNamespace(returncode=0,stdout=json.dumps({'signatureVerified':True,'releaseSha256':'b'*64,'sequence':2}))]
   with patch.object(S,'secure',side_effect=Path),patch.object(S,'pinned_file',side_effect=lambda p,h:Path(p)),patch.object(S.subprocess,'run',side_effect=replies) as run:
    result=S.admission(state,current)
    calls=[c.args[0] for c in run.call_args_list]
    self.assertEqual(calls[0][calls[0].index('--current')+1],'0'*64)
    self.assertEqual(calls[1][calls[1].index('--current')+1],'a'*64)
    self.assertEqual(calls[1][calls[1].index('--installed-sequence')+1],'1')
    self.assertEqual(result['sequence'],2)
 def test_authenticates_predecessor_then_successor(self):self.exercise()
 def test_rejects_wrong_predecessor(self):
  with self.assertRaises(S.Denied):self.exercise(lambda s,o,p:s['maintenanceAdmission'].update(releaseSha256='c'*64))
 def test_rejects_trust_replacement(self):
  with self.assertRaises(S.Denied):self.exercise(lambda s,o,p:s.update(trustSha256='other'))
 def test_rejects_recursive_receipt(self):
  def change(s,o,p):o['maintenanceAdmission']={};(p/'preparation.json').write_text(json.dumps(o))
  with self.assertRaises(S.Denied):self.exercise(change)
if __name__=='__main__':unittest.main()
