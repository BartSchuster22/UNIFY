"""Real PTY regression tests; confirmation only, never a real credential handoff."""
import errno,os,pty,select,signal,subprocess,sys,time,unittest
from pathlib import Path

class TerminalConfirmationTests(unittest.TestCase):
 def code(self):
  return ('import sys;sys.path.insert(0,'+repr(str(Path(__file__).parent))+');'
          'from onboarding import confirm;confirm("REVEAL");print("CONFIRMED",flush=True)')
 def terminal(self,answer):
  pid,fd=pty.fork()
  if pid==0:os.execl(sys.executable,sys.executable,'-c',self.code())
  output=b'';sent=False;status=None
  try:
   deadline=time.monotonic()+10
   while time.monotonic()<deadline:
    if select.select([fd],[],[],0.2)[0]:
     try:b=os.read(fd,8192)
     except OSError as e:
      if e.errno==errno.EIO:break
      raise
     if not b:break
     output+=b
     if not sent and b'proceed, or Enter to cancel:' in output:
      os.write(fd,answer+b'\n');sent=True
   done,status=os.waitpid(pid,os.WNOHANG)
   while not done and time.monotonic()<deadline:
    time.sleep(0.01);done,status=os.waitpid(pid,os.WNOHANG)
   if not done:
    os.kill(pid,signal.SIGKILL);os.waitpid(pid,0);self.fail('PTY child timed out')
   return os.waitstatus_to_exitcode(status),output
  finally:os.close(fd)
 def test_real_terminal_confirmation(self):
  code,out=self.terminal(b'REVEAL');self.assertEqual(code,0,out);self.assertIn(b'CONFIRMED',out)
 def test_real_terminal_cancellation(self):
  code,out=self.terminal(b'');self.assertNotEqual(code,0);self.assertIn(b'Cancelled; credentials unchanged',out);self.assertNotIn(b'CONFIRMED\r\n',out)
 def test_pipe_rejected(self):
  p=subprocess.run([sys.executable,'-c',self.code()],input='REVEAL\n',capture_output=True,text=True)
  self.assertNotEqual(p.returncode,0);self.assertIn('interactive terminal',p.stderr)
