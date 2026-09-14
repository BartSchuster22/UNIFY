"""Real pinned Caddy adapter ordering check; no ports or live configuration touched."""
import json,subprocess,tempfile,unittest
from pathlib import Path
from render import caddyfile
class CaddyOrder(unittest.TestCase):
 def test_private_deny_precedes_general_identity_proxy(self):
  base={'cell':'dsh2-test','origin':'https://dsh.example.com','owner':'owner','port':443,'bind':'127.0.0.1'}
  for mode in ['engineering','acme','proxy']:
   r={**base,'tls_mode':mode}
   if mode=='proxy':r['edge_network']='dsh2-test-edge'
   with tempfile.TemporaryDirectory() as temp:
    d=Path(temp);d.chmod(0o755);p=d/'Caddyfile';p.write_text(caddyfile(r));p.chmod(0o644)
    out=subprocess.check_output(['docker','run','--rm','--network','none','--entrypoint','caddy','-v',str(p)+':/etc/caddy/Caddyfile:ro','sha256:1b3a76433f6c1517aff303665985ff07addc39f16cf47aaa4efd633d579566cf','adapt','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],stderr=subprocess.PIPE,text=True)
   handlers=[]
   def visit(v):
    if isinstance(v,dict):
     if 'handler' in v:handlers.append(v)
     for x in v.values():visit(x)
    elif isinstance(v,list):
     for x in v:visit(x)
   visit(json.loads(out));deny=next(i for i,h in enumerate(handlers) if h.get('handler')=='static_response' and h.get('status_code')==404);proxy=next(i for i,h in enumerate(handlers) if h.get('handler')=='reverse_proxy');self.assertLess(deny,proxy,mode)
if __name__=='__main__':unittest.main()
