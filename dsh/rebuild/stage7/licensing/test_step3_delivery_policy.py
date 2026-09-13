import copy,io,json,tempfile,unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
import build_step3_delivery_policy as p
class PolicyTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.files=p.derive();cls.rows=json.loads(cls.files['delivery-decisions.json']);cls.summary=json.loads(cls.files['summary.json'])
  cls.groups=json.loads((p.assessment.OUT/'groups.json').read_bytes());cls.byid={g['groupId']:g for g in cls.groups}
 def test_all_groups_and_occurrences_once(self):
  self.assertEqual({r['groupId'] for r in self.rows},set(self.byid))
  ids=[(o['image'],o['artifactId']) for r in self.rows for o in r['occurrences']]
  self.assertEqual(len(ids),len(set(ids)));self.assertEqual(len(ids),3352)
 def test_no_legal_rewrite_or_lost_blockers(self):
  for r in self.rows:
   g=self.byid[r['groupId']]
   self.assertEqual(r['legalRequirements'],g['requirements']);self.assertEqual(r['originalBlockers'],g['blockers'])
   self.assertEqual([h['originCode'] for h in r['holds'] if h['stage']=='unresolved-assessment'],[b['code'] for b in g['blockers']])
 def test_proprietary_source_not_authorized(self):
  rows=[r for r in self.rows if r['route']=='first-party-protected'];self.assertTrue(rows)
  for r in rows:self.assertNotIn('full-third-party-source-and-build-material',[a['material'] for a in r['actions']]);self.assertFalse(r['distributionAuthorized'])
 def test_descriptors_no_fictitious_source(self):
  rows=[r for r in self.rows if r['route']=='proven-descriptor'];self.assertTrue(rows)
  for r in rows:self.assertEqual([a['material'] for a in r['actions']],['descriptor-cross-reference'])
 def test_conservative_scope_and_policy_label(self):
  rows=[r for r in self.rows if r['route']=='conservative-third-party-bundle'];self.assertTrue(rows)
  for r in rows:
   self.assertIn(r['situation']['kind'],p.POLICY['ordinaryBundleKinds'])
   a=next(a for a in r['actions'] if a['material']=='full-third-party-source-and-build-material');self.assertEqual(a['basis'],'additional-conservative-policy')
 def test_gsap_permission_hold_survives(self):
  r=next(r for r in self.rows if r['name']=='gsap');self.assertTrue(any(h['category']=='distribution-permission' for h in r['holds']));self.assertFalse(r['distributionAuthorized'])
 def test_replacement_not_marked_proven(self):
  acts=[a for r in self.rows for a in r['actions'] if a['material']=='replacement-or-relink-provision'];self.assertTrue(acts)
  for a in acts:self.assertFalse(a['fulfilled']);self.assertIn('never publish',a['detail'])
 def test_content_and_ownership_retained(self):
  categories={h['category'] for r in self.rows for h in r['holds']};self.assertIn('ownership',categories);self.assertIn('content-restrictions',categories)
 def test_required_extra_terms_preserved_in_actions(self):
  for r in self.rows:
   for k,v in r['legalRequirements'].items():
    if v.get('applicability')=='required' and k not in ['noticeDelivery','correspondingSource','buildInstructions','relinkOrReplacement']:
     self.assertTrue(any(a['material']==k and a['detail']==v['basis'] for a in r['actions']))
 def test_plan_completion_is_not_clearance(self):
  self.assertTrue(self.summary['policyAssignmentComplete'])
  for k in ['scopeDecisionCompletion','fulfilmentComplete','legalApproval','distributionAuthorized']:self.assertFalse(self.summary[k])
 def test_deterministic_replay(self):self.assertEqual(self.files,p.derive())
 def test_decision_does_not_mutate_assessment(self):
  g=copy.deepcopy(self.groups[0]);before=copy.deepcopy(g);p.decision(g);self.assertEqual(g,before)
 def test_cli_clearance_fail_closed(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'OUT',Path(d)),patch.object(p,'derive',return_value=self.files),patch('sys.argv',['policy','--require-clearance']),redirect_stdout(io.StringIO()):
   with self.assertRaises(SystemExit) as c:p.main()
   self.assertEqual(c.exception.code,2)
 def test_output_tamper_rejected(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p,'OUT',Path(d)),patch.object(p,'derive',return_value=self.files),patch('sys.argv',['policy','--verify']):
   for n,b in self.files.items():(Path(d)/n).write_bytes(b)
   (Path(d)/'summary.json').write_text('{"distributionAuthorized":true}')
   with self.assertRaisesRegex(ValueError,'output drift'):p.main()
if __name__=='__main__':unittest.main()
