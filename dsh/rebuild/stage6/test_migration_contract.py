import copy,json,unittest
from unittest.mock import patch
import migration_contract as m
import reference_restore as ref
class MigrationTests(unittest.TestCase):
 def setUp(self):
  self.s={k:[k+'-fixture'] for k in m.KINDS};self.p={k:[[v[0],v[0]]] for k,v in self.s.items()};self.o={k:{v[0]:v[0]} for k,v in self.s.items()}
 def runplan(self,**kw):return m.plan(**{'predecessor':m.PREDECESSOR,'source':self.s,'mapping':self.p,'occupied':self.o,'quiescent':True,'backup_verified':True,**kw})
 def test_preserve(self):self.assertEqual(self.runplan()['mode'],'preserve-only')
 def test_foreign_occupants(self):
  for k in m.KINDS:
   x=copy.deepcopy(self.o);x[k][self.s[k][0]]='foreign'
   with self.assertRaises(ValueError):self.runplan(occupied=x)
 def test_collisions(self):
  for k in m.KINDS:
   x=copy.deepcopy(self.s);x[k]+=x[k]
   with self.assertRaises(ValueError):self.runplan(source=x)
 def test_denials(self):
  for kw in [{'predecessor':'other'},{'quiescent':False},{'backup_verified':False},{'mapping':{}}]:
   with self.assertRaises(ValueError):self.runplan(**kw)
 def test_rebinding(self):
  self.p['channels'][0][1]='other'
  with self.assertRaises(ValueError):self.runplan()
class ReferenceTests(unittest.TestCase):
 def test_cold_ip_and_oom_default(self):
  net=ref.r.CELL+'_application';old={'Name':'/'+ref.r.CELL+'-caddy-1','Image':'fixture-image','Config':{'Labels':{}},'NetworkSettings':{'Networks':{net:{'IPAddress':'','Aliases':['stage5.qa.invalid']}}}}
  current=copy.deepcopy(old);current['NetworkSettings']['Networks'][net]['IPAddress']='10.84.0.9'
  app={'Name':'/dsh5-reference-qa5','Image':'fixture-reference','Config':{},'HostConfig':{'ExtraHosts':['stage5.qa.invalid:10.84.0.6'],'Privileged':False,'PidMode':'','NetworkMode':net,'OomKillDisable':None,'NanoCpus':500000000,'MemorySwap':268435456}}
  with patch.object(ref.os,'geteuid',return_value=0),patch.object(ref.socket,'gethostname',return_value='DSH2'),patch.object(ref.r,'run',return_value=json.dumps([current])):
   b=ref.body({'metadata':{'containers':[old,app]}})
   self.assertEqual(b['HostConfig']['ExtraHosts'],['stage5.qa.invalid:10.84.0.9']);self.assertIs(b['HostConfig']['OomKillDisable'],False);self.assertEqual(b['HostConfig']['NanoCpus'],500000000)
   app['HostConfig']['Privileged']=True
   with self.assertRaises(AssertionError):ref.body({'metadata':{'containers':[old,app]}})
if __name__=='__main__':unittest.main()
