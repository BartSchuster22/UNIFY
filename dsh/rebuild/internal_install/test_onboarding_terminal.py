"""Root-only real PTY test with generated disposable test credentials, never live ones."""
import fcntl,os,pty,secrets,subprocess,sys,tempfile,termios,unittest
from pathlib import Path
class TerminalHandoff(unittest.TestCase):
 @unittest.skipUnless(os.geteuid()==0,'Protected-path test requires root')
 def test_real_terminal_and_redirect_boundary(self):
  with tempfile.TemporaryDirectory(prefix='alica-handoff-test-',dir='/root') as tmp:
   path=Path(tmp)/'test-password';value=secrets.token_urlsafe(48);path.write_text(value);path.chmod(0o400)
   command=[sys.executable,'-c','import onboarding,sys;onboarding.reveal(sys.argv[1])',str(path)]
   denied=subprocess.run(command,capture_output=True,text=True,timeout=10)
   self.assertNotEqual(denied.returncode,0);self.assertNotIn(value,denied.stdout+denied.stderr)
   master,slave=pty.openpty()
   def attach():os.setsid();fcntl.ioctl(slave,termios.TIOCSCTTY,0)
   try:
    p=subprocess.Popen(command,stdin=slave,stdout=slave,stderr=subprocess.PIPE,preexec_fn=attach)
    _,err=p.communicate(timeout=10);self.assertEqual(p.returncode,0,err.decode());data=os.read(master,8192)
    self.assertIn(value.encode(),data);self.assertIn(b'NOT a permanent password',data);self.assertNotIn(value.encode(),err)
   finally:os.close(master);os.close(slave)
if __name__=='__main__':unittest.main()
