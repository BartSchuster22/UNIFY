import unittest
import compatibility as c
class CompatibilityTests(unittest.TestCase):
 def test_observed_supported_and_denials(self):
  h={'osId':'ubuntu','osVersion':'26.04','architecture':'x86_64','dockerVersion':'29.1.3','storageDriver':'overlay2','composeVersion':'2.40.3+ds1-0ubuntu1'}
  self.assertEqual(c.validate(h),h)
  for key in h:
   with self.assertRaises(ValueError):c.validate({**h,key:'unsupported'})
  with self.assertRaises(ValueError):c.validate({**h,'composeVersion':'2.40.30'})
if __name__=='__main__':unittest.main()
