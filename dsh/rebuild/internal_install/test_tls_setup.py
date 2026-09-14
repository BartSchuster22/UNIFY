import argparse,re,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import setup
import internal_operations
class ManagedTLSRequests(unittest.TestCase):
 def req(self,**kw):
  values=dict(cell='dsh2-internal',owner='owner',origin='https://dsh.example.com',port=443,bind='0.0.0.0',root='/opt/dsh2-internal',tls_mode='engineering',edge_network=None);values.update(kw)
  with tempfile.TemporaryDirectory() as temp:
   with patch.object(setup,'secure',return_value=Path(temp)/'dsh2-internal'):
    return setup.request(argparse.Namespace(**values))
 def test_old_request_unchanged(self):self.assertNotIn('tls_mode',self.req())
 def test_acme(self):self.assertEqual(self.req(tls_mode='acme')['tls_mode'],'acme')
 def test_proxy(self):self.assertEqual(self.req(tls_mode='proxy',edge_network='dsh2-internal-edge')['edge_network'],'dsh2-internal-edge')
 def test_reject_inconsistent_modes(self):
  for kw in [{'tls_mode':'bad'},{'tls_mode':'proxy'},{'tls_mode':'proxy','edge_network':'unify_ingress'},{'tls_mode':'acme','edge_network':'dsh2-internal-edge'},{'tls_mode':'acme','port':19443,'origin':'https://dsh.example.com:19443'}]:
   with self.assertRaises(setup.Denied):self.req(**kw)
 def test_namespace_boundaries(self):
  import ast
  pattern=ast.literal_eval(internal_operations.NEW)
  for name in ['dsh2-internal-dev3','dsh2-stage7-qa4']:self.assertIsNotNone(re.fullmatch(pattern,name))
  for name in ['unify','herman','dsh2-../other','dsh2-x;sh','dsh2-'+'x'*41]:self.assertIsNone(re.fullmatch(pattern,name))
if __name__=='__main__':unittest.main()
