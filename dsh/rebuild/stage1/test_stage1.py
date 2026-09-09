import copy
import unittest
from render import render, validate
from admission import admission, GIB

class Isolation(unittest.TestCase):
    def setUp(self): self.d=render()
    def test_baseline(self): self.assertEqual(validate(self.d), [])
    def test_single_framework(self): self.assertEqual([n for n in self.d['services'] if n in {'hermes','alica','herman'}], ['hermes'])
    def test_public_ingress_rejected(self):
        self.d['services']['caddy']['ports'][0]['host_ip']='0.0.0.0'; self.assertTrue(validate(self.d))
    def test_socket_rejected(self):
        self.d['services']['hermes']['volumes'].append('/var/run/docker.sock:/var/run/docker.sock'); self.assertTrue(validate(self.d))
    def test_production_mount_rejected(self):
        self.d['services']['hermes']['volumes'].append('/opt/unify/data:/opt/data'); self.assertTrue(validate(self.d))
    def test_external_volume_rejected(self):
        next(iter(self.d['volumes'].values()))['external']=True; self.assertTrue(validate(self.d))
    def test_external_network_rejected(self):
        self.d['networks']['memory']['internal']=False; self.assertTrue(validate(self.d))
    def test_excessive_capability_rejected(self):
        self.d['services']['hermes']['cap_add']=['SYS_ADMIN']; self.assertTrue(validate(self.d))
    def test_uncapped_memory_rejected(self):
        self.d['services']['hermes'].pop('mem_limit'); self.assertTrue(validate(self.d))
    def test_host_network_rejected(self):
        self.d['services']['hermes']['network_mode']='host'; self.assertTrue(validate(self.d))
    def test_second_runtime_rejected(self):
        self.d['services']['herman']=copy.deepcopy(self.d['services']['hermes']); self.assertTrue(validate(self.d))
    def test_no_memory_access_from_hermes(self):
        self.d['services']['hermes']['networks']['memory']={}; self.assertTrue(validate(self.d))
    def test_no_memory_backup_mount(self):
        self.assertFalse(any('backup' in v for v in self.d['services']['memory-v4']['volumes']))

class Admission(unittest.TestCase):
    # Explicit unit fixtures, never deployment evidence.
    def setUp(self):
        self.h={'os_id':'ubuntu','os_version':'26.04','architecture':'x86_64','docker_version':'29.1.3','compose_version':'2.40.3','cgroup_version':'2','cpus':4,'available_memory_bytes':5*GIB,'free_disk_bytes':40*GIB,'port_available':True,'namespace_free':True,'root_free':True,'errors':[]}
        self.d=render()
        self.l={'native_source_check':{'pass':True},'images':{n:{'id':'sha256:'+'0'*64,'size_bytes':128*1024**2} for n in ['hermes','unify-core','uniui','memory-v4','postgresql','keycloak','caddy']}}
    def test_admission_fixture(self): self.assertTrue(admission(self.h,self.d,self.l)['pass'])
    def test_memory_pressure(self):
        self.h['available_memory_bytes']=2*GIB; self.assertFalse(admission(self.h,self.d,self.l)['pass'])
    def test_disk_pressure(self):
        self.h['free_disk_bytes']=8*GIB; self.assertFalse(admission(self.h,self.d,self.l)['pass'])
    def test_occupied_port(self):
        self.h['port_available']=False; self.assertFalse(admission(self.h,self.d,self.l)['pass'])
    def test_existing_namespace(self):
        self.h['namespace_free']=False; self.assertFalse(admission(self.h,self.d,self.l)['pass'])
    def test_existing_root(self):
        self.h['root_free']=False; self.assertFalse(admission(self.h,self.d,self.l)['pass'])
    def test_missing_source_evidence(self):
        self.l['native_source_check']={}; self.assertFalse(admission(self.h,self.d,self.l)['pass'])
    def test_incomplete_image_lock(self):
        del self.l['images']['hermes']; self.assertFalse(admission(self.h,self.d,self.l)['pass'])
    def test_unsupported_runtime_not_silently_accepted(self):
        self.h['docker_version']='30.0.0'; self.assertFalse(admission(self.h,self.d,self.l)['pass'])
    def test_no_physical_8GiB_gate(self):
        self.h['memory_bytes']=7*GIB; self.assertTrue(admission(self.h,self.d,self.l)['pass'])

class RuntimeWiring(unittest.TestCase):
    def test_guard_does_not_race_auto_removed_jobs(self):
        import exercise
        from unittest.mock import patch
        with patch.object(exercise,'run',return_value='abc\n') as run:
            self.assertEqual(exercise.candidate_ids(),['abc'])
            self.assertIn('label=com.docker.compose.oneoff=False',run.call_args.args[0])
    def test_native_supervision_dependency_packaged(self):
        from pathlib import Path
        from render import ROOT
        docker=(ROOT/'Dockerfile.hermes-runtime').read_text()
        rel='deploy/hermes-runtime/rootfs/etc/s6-overlay/s6-rc.d/unify-hermes-gateway/'
        for f in ['up','type','dependencies.d/legacy-cont-init']:
            self.assertTrue((ROOT/rel/f).is_file())
            self.assertIn('COPY '+rel+f, docker)
        self.assertEqual((ROOT/rel/'type').read_text().strip(),'oneshot')
    def test_health_checks_actual_native_gateway(self):
        from render import ROOT
        text=(ROOT/'deploy/hermes-runtime/healthcheck.mjs').read_text()
        self.assertIn("assertServiceUp('gateway-default')",text)
        self.assertNotIn("assertServiceUp('unify-hermes-gateway')",text)
    def test_guard_blocks_later_start(self):
        import exercise
        from unittest.mock import patch
        exercise.ABORTED.set()
        try:
            with patch.object(exercise,'run') as run:
                with self.assertRaises(RuntimeError):exercise.compose('up','-d')
                run.assert_not_called()
        finally:exercise.ABORTED.clear()
    def test_guard_still_allows_stop(self):
        import exercise
        from unittest.mock import patch
        exercise.ABORTED.set()
        try:
            with patch.object(exercise,'run',return_value='') as run:
                exercise.compose('stop');run.assert_called_once()
        finally:exercise.ABORTED.clear()

if __name__=='__main__': unittest.main()
