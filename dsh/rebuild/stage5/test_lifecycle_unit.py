import unittest
from ops import lifecycle_unit
class LifecycleWiring(unittest.TestCase):
 def test_started_when_docker_returns_and_at_boot(self):
  text=lifecycle_unit('/srv/pinned','--root /opt/qa')
  self.assertIn('WantedBy=multi-user.target docker.service\n',text)
 def test_ordering_and_stop_propagation(self):
  text=lifecycle_unit('/srv/pinned','--root /opt/qa')
  for line in ['After=docker.service','Requires=docker.service','PartOf=docker.service','RemainAfterExit=yes']:
   self.assertIn(line+'\n',text)
 def test_uses_maintenance_aware_boot_not_raw_compose(self):
  text=lifecycle_unit('/srv/pinned','--root /opt/qa')
  self.assertIn('ExecStart=/usr/bin/python3 /srv/pinned/ops.py boot --root /opt/qa\n',text)
  self.assertNotIn('docker compose',text)
if __name__=='__main__':unittest.main()
