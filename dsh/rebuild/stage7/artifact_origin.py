"""Temporary exact-file artifact origin; no directory serving or credential access."""
import argparse,http.server,os,shutil,socketserver,stat,threading,time
from pathlib import Path
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
 daemon_threads=True
 slots=threading.BoundedSemaphore(4)
 def process_request(self,request,client_address):
  if not self.slots.acquire(blocking=False):request.close();return
  try:super().process_request(request,client_address)
  except BaseException:self.slots.release();raise
 def process_request_thread(self,request,client_address):
  try:super().process_request_thread(request,client_address)
  finally:self.slots.release()
def main():
 p=argparse.ArgumentParser();p.add_argument('--file',required=True);p.add_argument('--port',type=int,default=28444);p.add_argument('--seconds',type=int,default=1800);a=p.parse_args();f=Path(a.file).resolve();assert f.is_file()
 class Handler(http.server.BaseHTTPRequestHandler):
  def setup(self):super().setup();self.connection.settimeout(30)
  def log_message(self,format,*args):pass
  def serve(self,body):
   if self.path!='/'+f.name:self.send_error(404);return
   fd=os.open(f,os.O_RDONLY|os.O_NOFOLLOW)
   with os.fdopen(fd,'rb') as s:
    meta=os.fstat(s.fileno());assert stat.S_ISREG(meta.st_mode)
    self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Length',str(meta.st_size));self.end_headers()
    if body:shutil.copyfileobj(s,self.wfile,1048576)
  def do_GET(self):self.serve(True)
  def do_HEAD(self):self.serve(False)
 server=Server(('0.0.0.0',a.port),Handler);server.timeout=1;end=time.monotonic()+a.seconds
 print('Exact-file artifact origin ready',flush=True)
 try:
  while time.monotonic()<end:server.handle_request()
 finally:server.server_close()
if __name__=='__main__':main()
