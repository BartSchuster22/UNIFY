import argparse,contextlib,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
import onboarding as o
class Handoff(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.root=Path(self.t.name)
 def tearDown(self):self.t.cleanup()
 def args(self,action='onboarding',reveal=False):return argparse.Namespace(action=action,destination='/verified',root=str(self.root),reveal_initial_password=reveal)
 def mocks(self,status):
  stack=contextlib.ExitStack();stack.enter_context(patch.object(o.os,'geteuid',return_value=0));stack.enter_context(patch.object(o,'secure',side_effect=Path));stack.enter_context(patch.object(o,'read_state',return_value=(Path('/verified'),{}, {'releaseSha256':'a'*64})));stack.enter_context(patch.object(o,'inspect_owner',return_value=({'origin':'https://dsh.example.com','owner':'owner'},status)));return stack
 def test_status_no_password_or_reveal(self):
  with self.mocks({'temporaryPasswordRequired':True}),patch.object(o,'reveal') as reveal:
   result=o.run(self.args());self.assertTrue(result['initialPasswordAvailable']);reveal.assert_not_called();self.assertFalse(result['onboardingAccepted'])
 def test_changed_initial_is_never_revealed(self):
  with self.mocks({'temporaryPasswordRequired':False}),patch.object(o,'reveal') as reveal:
   with self.assertRaises(o.Denied):o.run(self.args(reveal=True))
   reveal.assert_not_called()
 def test_recovery_file_cannot_be_mistaken_for_valid_initial(self):
  (self.root/'secrets').mkdir();(self.root/'secrets/recovered-owner-password').touch()
  self.assertFalse(o.initial_available(self.root,{'temporaryPasswordRequired':True}))
 def test_pipe_denied(self):
  with patch.object(o.sys.stdin,'isatty',return_value=False),patch.object(o.sys.stdout,'isatty',return_value=True):
   with self.assertRaises(o.Denied):o.require_terminal()
 def test_redirect_denied(self):
  with patch.object(o.sys.stdin,'isatty',return_value=True),patch.object(o.sys.stdout,'isatty',return_value=False):
   with self.assertRaises(o.Denied):o.require_terminal()
 def test_nonroot_denied_before_reading_state(self):
  with patch.object(o.os,'geteuid',return_value=1000),patch.object(o,'read_state') as state:
   with self.assertRaises(o.Denied):o.run(self.args())
   state.assert_not_called()
 def test_cancel_does_not_reset(self):
  with self.mocks({'temporaryPasswordRequired':False}),patch.object(o,'confirm',side_effect=o.Denied('Cancelled')),patch.object(o.subprocess,'run') as run:
   with self.assertRaises(o.Denied):o.run(self.args('recover-owner'))
   run.assert_not_called()
 def test_failed_recovery_does_not_disclose(self):
  with self.mocks({'temporaryPasswordRequired':False}),patch.object(o,'confirm'),patch.object(o.subprocess,'run',return_value=argparse.Namespace(returncode=1)),patch.object(o,'reveal') as reveal:
   with self.assertRaises(o.Denied):o.run(self.args('recover-owner'))
   reveal.assert_not_called()
 def test_bad_recovery_receipt_does_not_disclose(self):
  with self.mocks({'temporaryPasswordRequired':True}),patch.object(o,'confirm'),patch.object(o.subprocess,'run',return_value=argparse.Namespace(returncode=0,stdout='{}')),patch.object(o,'reveal') as reveal:
   with self.assertRaises(o.Denied):o.run(self.args('recover-owner'))
   reveal.assert_not_called()
 def test_recovery_requires_success_and_identity_state(self):
  receipt={'owner_recovery':True,'existing_identity_sessions_revoked':True,'temporary_password_file':str(self.root/'secrets/recovered-owner-password')}
  with self.mocks({'temporaryPasswordRequired':True}),patch.object(o,'confirm'),patch.object(o.subprocess,'run',return_value=argparse.Namespace(returncode=0,stdout=json.dumps(receipt))) as run,patch.object(o,'reveal') as reveal:
   result=o.run(self.args('recover-owner'));self.assertTrue(result['ownerRecovery']);self.assertIn('recover-owner',run.call_args.args[0]);reveal.assert_called_once_with(self.root/'secrets/recovered-owner-password')
 def test_recovery_without_temporary_state_denied(self):
  receipt={'owner_recovery':True,'existing_identity_sessions_revoked':True,'temporary_password_file':str(self.root/'secrets/recovered-owner-password')}
  with self.mocks({'temporaryPasswordRequired':False}),patch.object(o,'confirm'),patch.object(o.subprocess,'run',return_value=argparse.Namespace(returncode=0,stdout=json.dumps(receipt))),patch.object(o,'reveal') as reveal:
   with self.assertRaises(o.Denied):o.run(self.args('recover-owner'))
   reveal.assert_not_called()
if __name__=='__main__':unittest.main()
