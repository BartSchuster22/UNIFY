import copy,unittest
from unittest.mock import patch
from pathlib import Path
import restore_dsh2 as r

class RestorePolicyTests(unittest.TestCase):
 def setUp(self):
  md={'sourceHost':'DSH2','activeCell':r.CELL,'releaseSha256':r.RELEASE,'roots':r.CELLS.copy(),'automaticJobsEnabled':0,'nativeBefore':{'tasks':[{'status':'done'} for _ in range(3)]},'volumes':[],'containers':[]};self.m={'metadata':md,'entries':[]}
  prefixes=['operations-code','qa-code','recovery-code','units']
  for c in r.CELLS:
   prefixes+=['root-'+c,'qa-'+c,'stage5-package-'+c.rsplit('-',1)[-1]]
   for n in ('alica-data','caddy-config','caddy-data','memory-data','postgresql-data'):
    name=c+'_'+n;prefixes.append('volume-'+name);md['volumes'].append({'Name':name,'Labels':{'com.alica.stage2':c,'com.docker.compose.project':c},'Driver':'local','Options':None,'Mountpoint':'/var/lib/docker/volumes/'+name+'/_data'})
  self.m['entries']=[{'name':n} for n in prefixes]
 def test_complete_mapping(self):self.assertEqual(len(r.destinations(self.m)),len(self.m['entries']))
 def test_source_host(self):
  self.m['metadata']['sourceHost']='production'
  with self.assertRaises(r.Refused):r.destinations(self.m)
 def test_active_work(self):
  self.m['metadata']['nativeBefore']['tasks'][0]['status']='running'
  with self.assertRaises(r.Refused):r.destinations(self.m)
 def test_enabled_schedules(self):
  self.m['metadata']['automaticJobsEnabled']=1
  with self.assertRaises(r.Refused):r.destinations(self.m)
 def test_foreign_volume(self):
  self.m['metadata']['volumes'][0]['Labels']['com.alica.stage2']='other'
  with self.assertRaises(r.Refused):r.destinations(self.m)
 def test_volume_path_escape(self):
  self.m['metadata']['volumes'][0]['Name']='../../etc'
  with self.assertRaises(r.Refused):r.destinations(self.m)
 def test_external_driver(self):
  self.m['metadata']['volumes'][0]['Driver']='nfs'
  with self.assertRaises(r.Refused):r.destinations(self.m)
 def test_unmapped_archive(self):
  self.m['entries'].append({'name':'unexpected'})
  with self.assertRaises(r.Refused):r.destinations(self.m)
 def test_unbacked_bind(self):
  self.m['metadata']['containers']=[{'Name':'/fixture','Config':{'Labels':{'com.alica.stage2':r.CELL}},'Mounts':[{'Type':'bind','Source':'/unbacked'}]}]
  with self.assertRaises(r.Refused):r.destinations(self.m)
 def test_wrong_host_apply_before_mutation(self):
  with patch.object(r.socket,'gethostname',return_value='ALICA-v1'):
   with self.assertRaises(r.Refused):r.apply(Path('/does-not-exist'),'different')
 def test_same_boot_apply_before_mutation(self):
  with patch.object(r.socket,'gethostname',return_value='DSH2'),patch.object(r.os,'geteuid',return_value=0):
   with self.assertRaises(r.Refused):r.apply(Path('/does-not-exist'),Path('/proc/sys/kernel/random/boot_id').read_text().strip())
if __name__=='__main__':unittest.main()
