import unittest
from capacity_guard import violations, GIB

class GuardTests(unittest.TestCase):
    def healthy(self):
        return dict(diskAvailableBytes=20*GIB, memoryAvailableBytes=5*GIB,
                    runningQaProjects=[], unreferencedStage1Archives=[])
    def test_idle_admitted(self):
        self.assertEqual(violations(self.healthy(), True), [])
    def test_disk(self):
        s=self.healthy();s['diskAvailableBytes']=7*GIB
        self.assertTrue(violations(s));self.assertTrue(violations(s,True))
    def test_ram(self):
        s=self.healthy();s['memoryAvailableBytes']=GIB
        self.assertTrue(violations(s));self.assertTrue(violations(s,True))
    def test_one_running_allowed_monitor_not_admission(self):
        s=self.healthy();s['runningQaProjects']=['dsh2-stage5-qa1']
        self.assertEqual(violations(s),[]);self.assertTrue(violations(s,True))
    def test_two_running_rejected(self):
        s=self.healthy();s['runningQaProjects']=['dsh2-stage4-qa4','dsh2-stage5-qa1']
        self.assertTrue(violations(s))
    def test_old_archives_rejected(self):
        s=self.healthy();s['unreferencedStage1Archives']=['superseded.tar']
        self.assertTrue(violations(s))
    def test_admission_stricter(self):
        s=self.healthy();s['diskAvailableBytes']=10*GIB;s['memoryAvailableBytes']=2*GIB
        self.assertEqual(violations(s),[]);self.assertEqual(len(violations(s,True)),2)
    def test_boundary(self):
        s=self.healthy();s['diskAvailableBytes']=12*GIB;s['memoryAvailableBytes']=3*GIB
        self.assertEqual(violations(s,True),[])

if __name__=='__main__':unittest.main()
