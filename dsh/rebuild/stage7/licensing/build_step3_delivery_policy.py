"""Approved conservative delivery policy layered over, never replacing, legal assessments.
Offline planning only. Does not collect/distribute source, execute payloads or clear holds.
"""
import argparse,collections,csv,io,json
from pathlib import Path
import build_step3_obligations as assessment
BASE=Path(__file__).resolve().parent
OUT=BASE/'clean-candidate-review/step3-delivery-policy'
POLICY={
 'id':'DSH-conservative-third-party-delivery-v1',
 'authorization':'User approved the recommendation: conservative delivery for ordinary mixed OS/runtime bundles, targeted exact review where extra material cannot resolve an issue.',
 'ordinaryBundleKinds':['os-package-bundle','standalone-runtime'],
 'sourceBoundary':'Exact third-party component source, downstream patches and applicable build/install/control material only. Not a source dump of the container or proprietary DSH application.',
 'publicationAuthority':False,
 'frozenCandidateChangesAuthorized':False,
 'exceptions':'No licence exception, alternative grant, distribution permission or combination compatibility is established by over-delivery.',
 'rights':'Keep original per-file grants, notices and recipient rights. Check permission for the source material itself before delivering it.',
 'relinkFallback':'Where library replacement cannot be demonstrated, determine and supply the applicable relink/application materials under appropriate rights. Escalate any proprietary-code implication; never publish it automatically.'}

def decision(g):
 families=set(g['licenceProfile']['families']);req=g['requirements']
 excluded=bool(families & {'first-party','descriptor'})
 ordinary=g['situation']['kind'] in POLICY['ordinaryBundleKinds']
 mixed=bool(g['blockers'] or g['licenceProfile']['unresolvedTerms'] or len(g['licenceProfile']['terms'])>1)
 conservative=ordinary and mixed and not excluded
 actions=[]
 def add(material,basis,detail):
  actions.append({'material':material,'basis':basis,'detail':detail,'fulfilled':False})
 if 'first-party' in families:
  add('first-party-rights-boundary','protection','No additional source publication obligation or authorization is created by this policy. Preserve third-party carve-outs and resolve authority separately.')
 elif 'descriptor' in families:
  add('descriptor-cross-reference','existing-assessment','Retain the proven zero-payload decision; dependencies are independently covered. No fictitious source archive or relink kit for metadata.')
 else:
  add('scoped-notices','existing-assessment-and-policy','Deliver complete scoped copyright/licence/NOTICE texts and per-file grants. Verify archive contents and recipient-accessible delivery; merely collecting evidence is not fulfilment.')
  if conservative:
   add('full-third-party-source-and-build-material','additional-conservative-policy',POLICY['sourceBoundary']+' Bind source/patch versions to this group and every occurrence; preserve build configuration and required installation/control material. Do not replace existing established duties with this label.')
  else:
   for field in ['correspondingSource','buildInstructions']:
    status=req.get(field,{}).get('applicability')
    if status=='required':add(field,'existing-assessment',req[field]['basis'])
    elif status=='blocked':add(field,'targeted-decision-needed','Do not infer a waiver. Resolve the exact non-ordinary-bundle scope recorded in the original assessment before selecting the delivery material.')
  potential_library='library-copyleft' in families or req.get('relinkOrReplacement',{}).get('applicability')=='required' or (conservative and bool(g['blockers']))
  if potential_library:
   route={'jvm-jar':'Demonstrate replacement of the covered JAR and required re-augmentation.',
          'python-source-or-extension':'Demonstrate replacement/import of the modified library; handle native extensions separately.',
          'embedded-compiled-component':'Do not infer a shared-library exemption for embedded compiled code. Determine applicable relink/application materials.'}.get(g['situation']['kind'],'Map covered native consumers and demonstrate an interface-compatible library replacement or provide applicable relink materials. Static ELF evidence is not a successful replacement test.')
   add('replacement-or-relink-provision','additional-conservative-policy' if conservative else 'existing-assessment',route+' '+POLICY['relinkFallback']+' Preserve necessary modification/reverse-engineering rights; determine User Product installation-information applicability rather than assuming it away.')
 for field,item in req.items():
  if item.get('applicability')=='required' and field not in ['noticeDelivery','correspondingSource','buildInstructions','relinkOrReplacement']:
   add(field,'existing-assessment',item['basis'])
 holds=[]
 for issue in g['blockers']:
  code=issue['code']
  category={'payload-ownership-incomplete':'ownership','content-licence-scope':'content-restrictions','gsap-standalone-bundle-grant-review':'distribution-permission','unresolved-licence-scope':'grant-and-file-scope','additional-notice-terms-scope-review':'grant-and-file-scope'}.get(code,'unclassified-exact-review')
  action=issue['action']
  if conservative and category=='grant-and-file-scope':
   action='No minimum-source waiver is sought. Resolve the supplied term/file/exception evidence for permission, restrictions and compatible grants over both the retained binary content and the proposed source material. Supplying extra source does not establish those rights.'
  holds.append({'category':category,'originCode':code,'stage':'unresolved-assessment','action':action,'terms':issue.get('terms',g['licenceProfile']['expressions']),'closed':False})
 if req.get('licenceCompatibility',{}).get('applicability')=='required':
  holds.append({'category':'combination-compatibility','originCode':'existing-compatibility-requirement','stage':'acceptance-prerequisite','action':'Validate actual linked/imported/embedded program boundaries and applicable exceptions. Use this group’s context hashes and occurrence-to-group/native-linking evidence. Do not infer compatibility or proprietary-source obligations from co-container presence.','closed':False})
 if 'first-party' in families:
  holds.append({'category':'first-party-authority','originCode':'existing-first-party-rights-requirement','stage':'acceptance-prerequisite','action':req.get('licensorAndThirdPartyCarveouts',{}).get('basis','Resolve licensor authority and third-party carve-outs.'),'closed':False})
 return {'groupId':g['groupId'],'name':g['name'],'version':g['version'],'purl':g['purl'],'type':g['type'],'occurrences':g['occurrences'],'situation':g['situation'],'noticeHashes':g['noticeHashes'],
         'legalAssessmentUnchanged':True,'legalRequirements':req,'originalBlockers':g['blockers'],
         'route':'first-party-protected' if 'first-party' in families else 'proven-descriptor' if 'descriptor' in families else 'conservative-third-party-bundle' if conservative else 'existing-assessment-with-targeted-holds' if g['blockers'] else 'existing-assessment',
         'actions':actions,'holds':holds,'fulfilled':False,'distributionAuthorized':False}

def derive():
 original=assessment.derive()
 for name,data in original.items():
  assessment.need((assessment.OUT/name).read_bytes()==data,'Underlying assessment drift: '+name)
 groups=json.loads(original['groups.json']);baseline=json.loads(original['summary.json'])
 records=[decision(g) for g in groups]
 assessment.need(len({r['groupId'] for r in records})==len(groups),'Duplicate/missing group')
 occurrences=[(o['image'],o['artifactId']) for r in records for o in r['occurrences']]
 assessment.need(len(occurrences)==len(set(occurrences))==baseline['occurrences'],'Duplicate/missing occurrence')
 hold_rows=[{'groupId':r['groupId'],'name':r['name'],'version':r['version'],'occurrences':r['occurrences'],'noticeHashes':r['noticeHashes'],'holds':r['holds']} for r in records if r['holds']]
 summary={'schema':'dsh-conservative-delivery-plan/v1','policyAssignmentComplete':True,'scopeDecisionCompletion':baseline['step3Complete'],
          'groups':len(records),'occurrences':len(occurrences),'routes':dict(collections.Counter(r['route'] for r in records)),
          'conservativeOccurrences':sum(len(r['occurrences']) for r in records if r['route']=='conservative-third-party-bundle'),
          'originalOpenGroups':baseline['blockedGroups'],'originalOpenOccurrences':baseline['blockedOccurrences'],
          'groupsWithHoldsOrAcceptancePrerequisites':len(hold_rows),'holdCategories':dict(collections.Counter(h['category'] for r in records for h in r['holds'])),
          'fulfilmentComplete':False,'legalApproval':False,'distributionAuthorized':False,'candidateLockSha256':baseline['candidateLockSha256']}
 outputs={'policy.json':assessment.enc(POLICY),'summary.json':assessment.enc(summary),'delivery-decisions.json':assessment.enc(records),'targeted-holds.json':assessment.enc(hold_rows)}
 s=io.StringIO();w=csv.writer(s,lineterminator='\n',quoting=csv.QUOTE_ALL)
 w.writerow(['groupId','name','version','route','occurrences','legalSourceApplicability','policyMaterials','holds','fulfilled'])
 for r in records:
  row=[r['groupId'],r['name'],r['version'],r['route'],str(len(r['occurrences'])),r['legalRequirements'].get('correspondingSource',{}).get('applicability','see original record'),'; '.join(a['material']+' ['+a['basis']+']' for a in r['actions']),'; '.join(h['category'] for h in r['holds']),'false']
  w.writerow(["'"+v if v.startswith(('=','+','-','@','\t','\r')) else v for v in row])
 outputs['delivery-ledger.csv']=s.getvalue().encode()
 lines=['# Approved conservative delivery policy — assigned, not fulfilled','','Policy assignment is complete. Scope-review holds and acceptance prerequisites are NOT cleared.','This does not mark the underlying Step 3 assessment complete or authorize distribution.','','| Route | Groups |','|---|---:|']
 lines += [f'| {k} | {v} |' for k,v in sorted(summary['routes'].items())]
 lines += ['',f"All {summary['occurrences']} occurrences are covered. Conservative provision applies to {summary['conservativeOccurrences']} occurrences.",f"Original open assessment: {summary['originalOpenOccurrences']} occurrences / {summary['originalOpenGroups']} groups, unchanged.",'','See `delivery-ledger.csv` for policy versus legal duties and `targeted-holds.json` for specific questions and evidence references.','No proprietary code publication, payload changes, licence purchases or source fulfilment performed.']
 outputs['STATUS.md']=('\n'.join(lines)+'\n').encode()
 inputs={'assessment/'+n:assessment.sha(v) for n,v in original.items()}
 for name in ['build_step3_delivery_policy.py','test_step3_delivery_policy.py']:inputs[name]=assessment.sha((BASE/name).read_bytes())
 outputs['receipt.json']=assessment.enc({'inputs':inputs,'outputs':{n:assessment.sha(v) for n,v in outputs.items()}})
 return outputs

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');p.add_argument('--require-clearance',action='store_true');a=p.parse_args()
 files=derive();OUT.mkdir(exist_ok=True)
 for name,data in files.items():
  if a.verify:assessment.need((OUT/name).read_bytes()==data,'Delivery policy output drift: '+name)
  else:(OUT/name).write_bytes(data)
 summary=json.loads(files['summary.json']);print(json.dumps(summary))
 if a.require_clearance and not summary['distributionAuthorized']:raise SystemExit(2)
if __name__=='__main__':main()
