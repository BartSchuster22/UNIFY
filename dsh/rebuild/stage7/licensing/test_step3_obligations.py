import io,json,struct,unittest
from unittest.mock import patch
from pathlib import Path
import build_step3_obligations as r
import collect_step3_context as c
class Rules(unittest.TestCase):
 def profile(self,text):return r.licence_profile([text])
 def test_literal_or_selects_mit(self):
  p=self.profile('MIT OR LGPL-3.0-or-later');self.assertEqual(p['terms'],['MIT']);self.assertEqual(p['selectedAlternatives'][0]['selected'],'MIT')
 def test_and_is_not_or(self):
  p=self.profile('MIT AND LGPL-3.0-or-later');self.assertIn('library-copyleft',p['families']);self.assertFalse(p['selectedAlternatives'])
 def test_slash_is_not_automatically_or(self):self.assertTrue(self.profile('MIT/Apache-2.0')['unresolvedTerms'])
 def test_array_is_not_or(self):self.assertIn('library-copyleft',r.licence_profile(['MIT','LGPL-2.1-only'])['families'])
 def test_exception_not_discarded(self):self.assertIn('WITH Classpath-exception-2.0',self.profile('GPL-2.0-only WITH Classpath-exception-2.0')['unresolvedTerms'])
 def test_invalid_gpl_version_rejected(self):self.assertIn('GPL-2.1-only',self.profile('GPL-2.1-only')['unresolvedTerms'])
 def test_custom_label_blocked(self):self.assertTrue(self.profile('public-domain')['unresolvedTerms'])
 def test_mit_source_na_has_reason(self):
  d,b=r.requirements(self.profile('MIT'),{'kind':'embedded-compiled-component'});self.assertFalse(b);self.assertEqual(d['correspondingSource']['applicability'],'not-required');self.assertTrue(d['correspondingSource']['basis']);self.assertFalse(d['noticeDelivery']['fulfilled'])
 def test_lgpl_static_relink_required(self):
  d,b=r.requirements(self.profile('LGPL-3.0-only'),{'kind':'embedded-compiled-component'});self.assertFalse(b);self.assertEqual(d['relinkOrReplacement']['applicability'],'required');self.assertIn('Embedded',d['relinkOrReplacement']['basis'])
 def test_lgpl_jar_is_not_automatic_exemption(self):
  d,b=r.requirements(self.profile('LGPL-2.1-only'),{'kind':'jvm-jar'});self.assertEqual(d['relinkOrReplacement']['applicability'],'required');self.assertIn('Step 4',d['relinkOrReplacement']['basis'])
 def test_mpl_source_not_relink_kit(self):
  d,b=r.requirements(self.profile('MPL-2.0'),{'kind':'embedded-compiled-component'});self.assertEqual(d['correspondingSource']['applicability'],'required');self.assertEqual(d['relinkOrReplacement']['applicability'],'not-required')
 def test_bsd_advertising_preserved(self):
  d,b=r.requirements(self.profile('BSD-4-Clause'),{'kind':'os-package-bundle'});self.assertEqual(d['advertisingAcknowledgement']['applicability'],'required')
 def test_unknown_blocks_all_source_waivers(self):
  d,b=r.requirements(self.profile('LicenseRef-Custom'),{'kind':'jvm-jar'});self.assertTrue(b);self.assertEqual(d['correspondingSource']['applicability'],'blocked')
 def test_missing_expression_rejected(self):
  for value in ['MIT OR','MIT WITH','(MIT','MIT,Apache-2.0','MIT extra']:
   with self.assertRaises(ValueError):r.parse_expression(value)
 def test_elf_observes_needed_not_runtime_proof(self):
  data=bytearray(4096);data[:16]=b'\x7fELF'+bytes([2,1,1])+bytes(9)
  struct.pack_into('<HHIQQQIHHHHHH',data,16,2,62,1,0,64,0,0,64,56,3,0,0,0)
  for i,p in enumerate([(1,5,0,0x400000,0,len(data),len(data),4096),(2,6,512,0x400200,0,64,64,8),(3,4,384,0x400180,0,28,28,1)]):struct.pack_into('<IIQQQQQQ',data,64+i*56,*p)
  strings=b'\0libc.so.6\0';data[768:768+len(strings)]=strings;data[384:384+28]=b'/lib64/ld-linux-x86-64.so.2\0'.ljust(28,b'\0')
  for i,p in enumerate([(5,0x400300),(10,len(strings)),(1,1),(0,0)]):struct.pack_into('<qQ',data,512+i*16,*p)
  e=c.elf(io.BytesIO(data))
  if e is None:self.fail('ELF not detected')
  self.assertEqual(e['needed'],['libc.so.6']);self.assertIn('not excluded',e['coverage'])
class Evidence(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.files=r.derive();cls.groups=json.loads(cls.files['groups.json']);cls.members=json.loads(cls.files['occurrence-to-group.json'])
 def test_complete_unique_membership(self):
  q=json.loads((r.B/'candidate-package-evidence.json').read_bytes());self.assertEqual({(x['image'],x['artifactId']) for x in q},{(x['image'],x['artifactId']) for x in self.members});self.assertEqual(len(q),len(self.members))
 def test_no_empty_groups(self):self.assertTrue(all(g['occurrences'] for g in self.groups))
 def test_no_false_fulfilment(self):self.assertTrue(all(not d['fulfilled'] for g in self.groups for d in g['requirements'].values()))
 def test_repeated_groups_exist(self):self.assertTrue(any(len(g['occurrences'])>1 for g in self.groups))
 def test_scope_gate_tracks_open_work(self):
  s=json.loads(self.files['summary.json']);self.assertEqual(s['step3Complete'],not any(g['blockers'] for g in self.groups));self.assertFalse(s['engineeringComplete']);self.assertFalse(s['legalApproval'])
 def test_every_na_has_basis(self):self.assertTrue(all(d['basis'] for g in self.groups for d in g['requirements'].values() if d['applicability']=='not-required'))
 def test_context_tamper_rejected(self):
  original=Path.read_bytes;target=r.B/'step3-context.json'
  def changed(path):
   data=original(path)
   if path==target:
    obj=json.loads(data);obj['packages'][0]['payloadSignature']='0'*64;return r.enc(obj)
   return data
  with patch.object(Path,'read_bytes',changed):
   with self.assertRaisesRegex(ValueError,'Changed owned payload'):r.derive()
 def test_group_identity_binds_linkage_context(self):
  for g in self.groups:
   shape={k:v for k,v in g.items() if k not in ['groupId','componentFamilyId','occurrences']}
   self.assertEqual(r.sha(r.enc(shape)),g['groupId'])
   shape['situation']=dict(shape['situation'],incomingNativeContextSha256='changed')
   self.assertNotEqual(r.sha(r.enc(shape)),g['groupId'])
 def test_additional_font_licence_not_waived(self):
  fonts=[g for g in self.groups if g['name']=='fonts-noto-color-emoji'];self.assertTrue(fonts)
  self.assertTrue(all(g['blockers'] and g['requirements']['correspondingSource']['applicability']!='not-required' for g in fonts))
 def test_gsap_is_not_unrestricted_mit(self):
  gsap=next(g for g in self.groups if g['name']=='gsap');self.assertEqual(gsap['licenceProfile']['families'],['restricted-no-charge']);self.assertTrue(gsap['blockers'][0]['allRetainedPackageFilesMatchExactArchive']);self.assertEqual(gsap['requirements']['standaloneRedistributionPermission']['applicability'],'blocked')
 def test_completion_cli_fails_closed(self):
  import tempfile,contextlib
  with tempfile.TemporaryDirectory() as directory,patch.object(r,'OUT',Path(directory)),patch.object(r,'derive',return_value=self.files),patch('sys.argv',['review','--require-complete']),contextlib.redirect_stdout(io.StringIO()):
   with self.assertRaises(SystemExit) as raised:r.main()
   self.assertEqual(raised.exception.code,2)
 def test_canonical_replay(self):self.assertEqual(self.files,r.derive())
if __name__=='__main__':unittest.main()
