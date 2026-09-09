import unittest
from render import render,realm,caddyfile,validate_request
R={'cell':'dsh2-test','origin':'https://stage2.dsh.invalid:19443','port':19443,'bind':'127.0.0.1','owner':'owner'}
class Render(unittest.TestCase):
 def test_runtime_database_role_is_not_bootstrap(self):
  d=render(R)
  self.assertEqual(d['services']['postgresql']['environment']['POSTGRES_USER'],'unify_bootstrap')
  self.assertEqual(d['services']['migrate']['environment']['DATABASE_URL_FILE'],'/run/secrets/migration-database-url')
  self.assertFalse(any('migration-database-url' in v for v in d['services']['unify-core']['volumes']))
 def test_identity_boundary(self):
  d=render(R);s=d['services'];self.assertEqual(s['unify-core']['environment']['AUTH_MODE'],'oidc');self.assertNotIn('bootstrap-admin',s);self.assertNotIn('herman',s);self.assertEqual(len([v for v in s.values() if 'jobs' not in v.get('profiles',[])]),7)
 def test_private_graph_and_model_egress(self):
  d=render(R);self.assertEqual([n for n,v in d['services'].items() if 'model-egress' in v.get('networks',[])],['hermes']);self.assertEqual([n for n,v in d['services'].items() if v.get('ports')],['caddy']);self.assertEqual(d['services']['memory-v4']['networks'],['memory'])
 def test_no_password_grant_or_wildcard_redirect(self):
  r=realm(R,'fixture-client','fixture-owner');c=r['clients'][0];self.assertFalse(c['directAccessGrantsEnabled']);self.assertFalse(c['publicClient']);self.assertEqual(c['redirectUris'],[R['origin']+'/api/v1/auth/oidc/callback']);self.assertEqual(r['users'][0]['requiredActions'],['UPDATE_PASSWORD'])
 def test_edge_does_not_publish_admin(self):self.assertIn('respond @private 404',caddyfile(R))
 def test_no_silent_tls_bypass(self):self.assertNotIn('--no-check-certificate',str(render(R)))
 def test_reject_bad_request(self):
  for change in [{'origin':'http://stage2.dsh.invalid:19443'},{'port':443},{'cell':'dsh-stage1'},{'owner':'owner;command'},{'bind':'::'},{'origin':'https://evil@example.com:19443'}]:
   with self.subTest(change=change):self.assertRaises(ValueError,validate_request,{**R,**change})
if __name__=='__main__':unittest.main()
