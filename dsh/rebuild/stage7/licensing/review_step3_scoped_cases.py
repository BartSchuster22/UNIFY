"""Explicit, hash-bound substantive licence reviews; not name-only exemptions."""
CASES={
 ('rust-crate','target-lexicon','0.13.5'):{
  'hashes':['268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5'],
  'terms':['Apache-2.0 WITH LLVM-exception'],
  'decision':'Retain the entire Apache/LLVM notice and comply with Apache sections 3, 4 and 9. Do not exercise the optional 4(a)/4(b)/4(d) compilation waiver or the conditional GPLv2 conflict waiver. Embedded compilation therefore receives no notice exemption. This grant imposes no corresponding-source or relink-kit delivery duty.',
  'special':{'apacheComplianceWithoutExceptionReliance':'Retain licence, applicable NOTICE, change notices and patent/trademark conditions. Exception remains in the delivered text but is not relied upon to omit conditions.'}},
 ('rust-crate','webpki-root-certs','1.0.6'):{
  'hashes':['e271993808fec50ab29350b39539cdec611a9103f827e0aa26d61da70e2d33f8'],
  'terms':['CDLA-Permissive-2.0'],
  'decision':'The root certificate dataset is shared as embedded data, not merely computational Results. Section 2.1 requires making the agreement text available with the shared data, modified or not. There is no corresponding-source, build-script or relink-material requirement in this agreement. Section 3.1 on Results is not used to waive the shared-data notice.',
  'special':{'sharedDataAgreement':'Make the full CDLA-Permissive-2.0 text available with the distributed certificate data. Preserve the disclaimer; no unrestricted grant over unrelated code is inferred.'}},
 ('rust-crate','libbz2-rs-sys','0.2.2'):{
  'hashes':['54e1fd7bd53273e601c9599eb162a004dacddee031ae297ee7109a7beb93b1c2'],
  'terms':['bzip2-1.0.6'],
  'decision':'The supplied notice explicitly covers the Rust translation derived from bzip2/libbzip2. Source and binary redistribution are permitted. Clauses 1–4 retain source notices, forbid misrepresented origin, require altered source to be marked, and prohibit unapproved endorsement. Product-documentation acknowledgement is appreciated, not mandated. No source offer, build or application-relink duty is imposed.',
  'special':{'originChangesAndEndorsement':'Preserve source notices when conveying source; do not misrepresent authorship, mark altered source, and do not claim endorsement. DSH retains the full notice also in binary delivery as audit policy.'}}
}
def apply(row,evidence,profile,requirements,issues,read):
 case=CASES.get((row['type'],row['name'],row['version']))
 if not case:return profile,requirements,issues
 if sorted(profile.get('expressions',[]))!=sorted(case['terms']):raise ValueError('Scoped review declaration changed')
 hashes=sorted({d['sha256'] for d in evidence})
 if hashes!=sorted(case['hashes']):raise ValueError('Scoped review notice set changed')
 # Validate actual bytes, not just the names in a recognition report.
 import io,tarfile,hashlib
 with tarfile.open(fileobj=io.BytesIO(read('source-disposition-review/notice-evidence.tar'))) as archive:
  for h in hashes:
   f=archive.extractfile('notices/'+h)
   if f is None or hashlib.sha256(f.read()).hexdigest()!=h:raise ValueError('Scoped review notice bytes changed')
 profile={'expressions':profile['expressions'],'terms':case['terms'],'families':['reviewed-non-copyleft-scope'],'selectedAlternatives':[], 'unresolvedTerms':[], 'scopedReview':case}
 req={k:{'applicability':'not-required','basis':case['decision'],'fulfilled':False} for k in ['correspondingSource','buildInstructions','relinkOrReplacement']}
 req['noticeDelivery']={'applicability':'required','basis':'Retain the complete reviewed notice; fulfil the specific requirements below.','fulfilled':False}
 for k,v in case['special'].items():req[k]={'applicability':'required','basis':v,'fulfilled':False}
 # The review resolves only these term/scope questions, not unrelated evidence failures.
 remaining=[x for x in issues if x['code'] not in ['unresolved-licence-scope','additional-notice-terms-scope-review']]
 return profile,req,remaining
