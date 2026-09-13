import io,tarfile,unittest
from pathlib import Path
import review_step3_scoped_cases as r
BASE=Path(__file__).resolve().parent
class ScopedReviews(unittest.TestCase):
 def args(self,key):
  c=r.CASES[key]
  return [dict(zip(['type','name','version'],key)),[{'sha256':h} for h in c['hashes']],{'expressions':c['terms']},{},[{'code':'unresolved-licence-scope'},{'code':'additional-notice-terms-scope-review'}],lambda p:(BASE/p).read_bytes()]
 def test_actual_notice_bytes_all_cases(self):
  for k in r.CASES:
   with self.subTest(key=k):
    p,q,b=r.apply(*self.args(k));self.assertFalse(b);self.assertFalse(p['unresolvedTerms']);self.assertEqual(q['noticeDelivery']['applicability'],'required')
    for n in ['correspondingSource','buildInstructions','relinkOrReplacement']:self.assertEqual(q[n]['applicability'],'not-required')
 def test_changed_notice_set_rejected(self):
  a=self.args(next(iter(r.CASES)));a[1].append({'sha256':'f'*64})
  with self.assertRaisesRegex(ValueError,'notice set'):r.apply(*a)
 def test_changed_declaration_rejected(self):
  a=self.args(next(iter(r.CASES)));a[2]={'expressions':['GPL-2.0-only']}
  with self.assertRaisesRegex(ValueError,'declaration'):r.apply(*a)
 def test_changed_document_bytes_rejected(self):
  a=self.args(next(iter(r.CASES)));b=io.BytesIO()
  with tarfile.open(fileobj=b,mode='w') as t:
   info=tarfile.TarInfo('notices/'+a[1][0]['sha256']);data=b'not the reviewed grant';info.size=len(data);t.addfile(info,io.BytesIO(data))
  a[-1]=lambda p:b.getvalue()
  with self.assertRaisesRegex(ValueError,'notice bytes'):r.apply(*a)
 def test_other_versions_not_overridden(self):
  a=self.args(next(iter(r.CASES)));a[0]['version']='unreviewed'
  self.assertEqual(r.apply(*a),(a[2],a[3],a[4]))
 def test_unrelated_blocker_preserved(self):
  a=self.args(next(iter(r.CASES)));a[4].append({'code':'payload-ownership-incomplete'})
  self.assertEqual(r.apply(*a)[2],[{'code':'payload-ownership-incomplete'}])
 def test_cdla_results_not_used_as_data_waiver(self):
  p,q,b=r.apply(*self.args(('rust-crate','webpki-root-certs','1.0.6')))
  self.assertEqual(q['sharedDataAgreement']['applicability'],'required');self.assertIn('not used',p['scopedReview']['decision'])
 def test_llvm_notice_waiver_not_exercised(self):
  p,q,b=r.apply(*self.args(('rust-crate','target-lexicon','0.13.5')))
  self.assertIn('not relied',q['apacheComplianceWithoutExceptionReliance']['basis'])
if __name__=='__main__':unittest.main()
