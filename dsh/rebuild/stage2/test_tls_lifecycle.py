import contextlib,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import tls_lifecycle as tls
from render import render,caddyfile,validate_request
R={'cell':'dsh2-dev','origin':'https://dsh-dev.aquiero.com','port':443,'bind':'127.0.0.1','owner':'owner'}
class TLS(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.s=self.root/'secrets';self.s.mkdir();tls.ensure(self.s,'dsh-dev.aquiero.com')
 def tearDown(self):self.temp.cleanup()
 def test_real_keys_hostname_and_repeat(self):
  before=tls.contents(self.s);tls.ensure(self.s,'dsh-dev.aquiero.com');self.assertEqual(before,tls.contents(self.s));self.assertFalse(tls.due(self.s))
  with self.assertRaises(RuntimeError):tls.check(self.s,'wrong.invalid')
 def test_expiry_and_new_leaf_keep_ca(self):
  old=tls.contents(self.s);fresh=tls.staged(self.s,'dsh-dev.aquiero.com');self.assertEqual(old['framework-ca.crt'],fresh['framework-ca.crt']);self.assertNotEqual(old['alica.crt'],fresh['alica.crt'])
  with patch.object(tls,'expires',return_value=True):self.assertTrue(tls.due(self.s));rotated=tls.staged(self.s,'dsh-dev.aquiero.com')
  self.assertNotEqual(old['framework-ca.crt'],rotated['framework-ca.crt'])
 def test_symlink_rejected(self):
  p=self.s/'edge.key';p.unlink();p.symlink_to(self.root/'outside')
  with self.assertRaises(RuntimeError):tls.ensure(self.s,'dsh-dev.aquiero.com')
 def test_incomplete_rejected(self):
  (self.s/'edge.crt').unlink()
  with self.assertRaises(RuntimeError):tls.ensure(self.s,'dsh-dev.aquiero.com')
 def test_renew_and_failed_restart_recovery(self):
  class Fake:
   root=self.root;r=R
   class tx:
    locked=staticmethod(contextlib.nullcontext)
   def stop(self):self.stopped=True
   def start(self):
    if self.fail:raise RuntimeError('injected restart failure')
    tls.check(self.root/'secrets','dsh-dev.aquiero.com')
  i=Fake();i.fail=False;old=tls.contents(self.s);inodes={n:(self.s/n).stat().st_ino for n in tls.NAMES}
  self.assertEqual(tls.renew(i,True)['tls'],'renewed');self.assertEqual(inodes,{n:(self.s/n).stat().st_ino for n in tls.NAMES})
  self.assertNotEqual(old['alica.crt'],tls.contents(self.s)['alica.crt']);old=tls.contents(self.s);i.fail=True
  with self.assertRaises(RuntimeError):tls.renew(i,True)
  self.assertEqual(old,tls.contents(self.s));self.assertTrue((self.s/'.tls-renewal-recovery').exists())
  with self.assertRaises(RuntimeError):tls.renew(i,True)
  i.fail=False;self.assertEqual(tls.recover(i)['tls'],'recovered');self.assertFalse((self.s/'.tls-renewal-recovery').exists())
class PublicTLS(unittest.TestCase):
 def test_acme_graph(self):
  r={**R,'tls_mode':'acme'};d=render(r);c=d['services']['caddy'];self.assertEqual([p['published'] for p in c['ports']],['80','443']);self.assertIn('acme-egress',c['networks']);self.assertNotIn('edge.crt',caddyfile(r))
 def test_proxy_graph(self):
  r={**R,'tls_mode':'proxy','edge_network':'dsh2-dev-edge'};d=render(r)
  self.assertFalse(any(s.get('ports') for s in d['services'].values()));self.assertTrue(d['networks']['public-edge']['external']);self.assertEqual([n for n,s in d['services'].items() if 'public-edge' in s.get('networks',{})],['caddy']);self.assertIn('respond @private 404',caddyfile(r))
 def test_bad_modes(self):
  for change in [{'tls_mode':'invalid'},{'tls_mode':'proxy'},{'tls_mode':'acme','port':19443},{'tls_mode':'proxy','edge_network':'unify_unify-ingress'}]:
   with self.assertRaises(ValueError):validate_request({**R,**change})
if __name__=='__main__':unittest.main()
