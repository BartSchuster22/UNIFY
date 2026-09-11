import unittest
from package import overlay_target
class RuntimeLayout(unittest.TestCase):
 def test_core_actual_entrypoint(self):
  self.assertEqual(overlay_target('unify-core',{'Config':{'Cmd':['dist/server.js'],'WorkingDir':'/app'}}),'/app/dist')
 def test_ui_actual_served_directory(self):
  self.assertEqual(overlay_target('uniui',{'Config':{'Cmd':['server.mjs'],'WorkingDir':'/app'}}),'/app/public')
 def test_other_layout_fails_closed(self):
  with self.assertRaises(AssertionError):overlay_target('uniui',{'Config':{'Cmd':['other.js'],'WorkingDir':'/app'}})
  with self.assertRaises(AssertionError):overlay_target('unify-core',{'Config':{'Cmd':['dist/server.js'],'WorkingDir':'/other'}})
if __name__=='__main__':unittest.main()
