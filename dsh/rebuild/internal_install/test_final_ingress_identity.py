import copy,hashlib,json,unittest
from maintenance import final_ingress_signature,verified_runtime,SERVICES
from unittest.mock import patch

class RuntimeVerificationTests(unittest.TestCase):
 def test_accepts_verified_healthy_inventory(self):
  snap={'ownershipVerified':True,'services':{s:{'state':'healthy'} for s in SERVICES}}
  with patch('maintenance.collect',return_value=snap):self.assertEqual(verified_runtime({}),snap)
 def test_rejects_unverified_unhealthy_or_incomplete_inventory(self):
  for condition in ['ownership','health','inventory']:
   with self.subTest(condition=condition):
    snap={'ownershipVerified':True,'services':{s:{'state':'healthy'} for s in SERVICES}}
    if condition=='ownership':snap['ownershipVerified']=False
    if condition=='health':snap['services']['caddy']['state']='unknown'
    if condition=='inventory':snap['services'].pop('caddy')
    with patch('maintenance.collect',return_value=snap),self.assertRaises(RuntimeError):verified_runtime({})

def fingerprint(row):
 return hashlib.sha256(json.dumps([row['Config'],row['HostConfig']],sort_keys=True).encode()).hexdigest()

class FinalIngressIdentityTests(unittest.TestCase):
 def setUp(self):
  self.before={'Name':'/cell-caddy-1','Image':'sha256:pinned','Config':{'Image':'sha256:pinned','Cmd':['run'],'Labels':{'com.docker.compose.service':'caddy','com.docker.compose.depends_on':'uniui:service_healthy:false'}},'HostConfig':{'Privileged':False},'Mounts':[{'Type':'bind','Source':'/cell/Caddyfile','Destination':'/etc/caddy/Caddyfile','RW':False}]}
  self.after=copy.deepcopy(self.before)
  self.after['Config']['Labels'].update({'com.docker.compose.depends_on':'','com.docker.compose.replace':'caddy-1'})
 def test_accepts_only_known_compose_bookkeeping(self):
  self.assertEqual(final_ingress_signature(self.before,self.after,fingerprint),fingerprint(self.after))
 def test_rejects_execution_changes(self):
  for key,value in [('Cmd',['other']),('Image','other')]:
   with self.subTest(key=key):
    row=copy.deepcopy(self.after);row['Config'][key]=value
    with self.assertRaises(RuntimeError):final_ingress_signature(self.before,row,fingerprint)
  row=copy.deepcopy(self.after);row['HostConfig']['Privileged']=True
  with self.assertRaises(RuntimeError):final_ingress_signature(self.before,row,fingerprint)
 def test_rejects_other_labels(self):
  self.after['Config']['Labels']['foreign']='unexpected'
  with self.assertRaises(RuntimeError):final_ingress_signature(self.before,self.after,fingerprint)
 def test_rejects_image_name_and_mount_changes(self):
  for field,value in [('Image','other'),('Name','/foreign'),('Mounts',[])]:
   with self.subTest(field=field):
    row=copy.deepcopy(self.after);row[field]=value
    with self.assertRaises(RuntimeError):final_ingress_signature(self.before,row,fingerprint)
