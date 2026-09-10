import copy,importlib.util,json,os,shlex,subprocess,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('stage5_package',Path(__file__).with_name('package.py'))
assert spec is not None and spec.loader is not None
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Readiness(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.d=Path(self.tmp.name)
  self.secret=self.d/'password';self.secret.write_text('unit-test-secret\n')
  stub=self.d/'psql';stub.write_text('#!/usr/bin/env python3\nimport os,json,sys\nfrom pathlib import Path\nPath(os.environ["CALL"]).write_text(json.dumps({"args":sys.argv[1:],"passwordCorrect":os.environ.get("PGPASSWORD")=="unit-test-secret","timeout":os.environ.get("PGCONNECT_TIMEOUT")}))\nprint("unit-test-secret",file=sys.stderr)\nraise SystemExit(int(os.environ["SQL_EXIT"]))\n');stub.chmod(0o700)
 def run_probe(self,code):
  env={**os.environ,'PATH':str(self.d)+':'+os.environ['PATH'],'SQL_EXIT':str(code),'CALL':str(self.d/'call')}
  cmd=p.POSTGRES_READINESS.replace('/run/secrets/postgres-password',shlex.quote(str(self.secret)))
  return subprocess.run(['sh','-c',cmd],env=env,capture_output=True,text=True,timeout=5)
 def test_success_authenticates_and_queries_required_database(self):
  r=self.run_probe(0);self.assertEqual(r.returncode,0)
  c=json.loads((self.d/'call').read_text());self.assertTrue(c['passwordCorrect']);self.assertEqual(c['timeout'],'2')
  self.assertEqual(c['args'],['-X','-w','-h','postgresql','-p','5432','-U','unify_bootstrap','-d','unify','-v','ON_ERROR_STOP=1','-Atqc','SELECT 1'])
  self.assertEqual(r.stdout+r.stderr,'')
 def test_sql_errors_fail_closed(self):
  for code in (1,2,3):
   with self.subTest(code=code):
    r=self.run_probe(code);self.assertNotEqual(r.returncode,0);self.assertEqual(r.stdout+r.stderr,'')
 def test_missing_secret_prevents_query(self):
  self.secret.unlink();self.assertNotEqual(self.run_probe(0).returncode,0);self.assertFalse((self.d/'call').exists())
 def test_preserves_security_and_time_budgets(self):
  c={'services':{'postgresql':{'healthcheck':{'test':['CMD-SHELL','pg_isready'],'interval':'5s','timeout':'3s','retries':30},'environment':{'POSTGRES_PASSWORD_FILE':'/run/secrets/postgres-password'},'networks':['database']}}}
  before=copy.deepcopy(c);p.configure_postgres_readiness(c)
  self.assertEqual(c['services']['postgresql']['healthcheck']['test'],['CMD-SHELL',p.POSTGRES_READINESS])
  c['services']['postgresql']['healthcheck']['test']=before['services']['postgresql']['healthcheck']['test'];self.assertEqual(c,before)
if __name__=='__main__':unittest.main()
