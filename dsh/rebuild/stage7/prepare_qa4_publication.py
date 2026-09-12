"""Build publication files from validated, real fresh-OS evidence. Does not push."""
import hashlib,json,re,shutil,subprocess
from pathlib import Path
import finalize_qa4 as v
S=Path(__file__).parent;F=S/'evidence/candidates/72297c3/fresh-os-live';PUB=Path('/home/herman/stage7-qa4-verdict-publication/docs/stage7/candidates/72297c3/fresh-os')
def main():
 verdict=v.main()
 safeguard=json.loads((F/'post-acceptance/post-privacy-safeguard.json').read_text());quiet=json.loads((F/'post-acceptance/quiesced.json').read_text())
 assert safeguard['sourceLeftQuiesced'] and quiet['allEightStopped'] and quiet['operationUnitsDisabled']
 for key in ['elioVerification','developmentVerification']:
  r=safeguard[key];assert r['authenticationVerified'] and r['contentsVerified'] and r['manifestSha256']==safeguard['receipt']['manifestSha256']
 verdict['postAcceptanceState']='encrypted safeguards independently verified on both hosts; DSH2 intentionally quiesced'
 verdict['safeguardSha256']=v.sha(F/'post-acceptance/post-privacy-safeguard.json')
 (F/'final-verdict.json').write_text(json.dumps(verdict,indent=2)+'\n')
 doc=(S/'FINAL-QA4.md').read_text()+'''\n## Post-acceptance state\n\nAfter the healthy acceptance snapshot, the fresh run was encrypted with its recovery/update working state and anti-replay counters. Both backup hosts independently authenticated and verified all archived entries. DSH2 was then left quiesced with its operation units disabled, rather than leaving accepted QA live. No production deployment was made.\n\nThe initial release README and original pending/false flags are historical publication-time checkpoints, not the current scoped verdict. The immutable candidate archive and initial assets remain unchanged. The fresh run's initial OIDC attempt stopped at the dedicated-host guard before authentication; enrollment was subsequently bound to the verified provider identity, and the genuine OIDC test passed without reinstalling or replacing business outcomes.\n'''
 (S/'FINAL-QA4.md').write_text(doc)
 PUB.mkdir(parents=True,exist_ok=False)
 files={'stage7-qa4-verdict.json':F/'final-verdict.json','stage7-qa4-evidence.json':F/'exported-evidence.json','stage7-qa4-failures.json':F/'failure-ledger.json','stage7-qa4-input-hashes.json':F/'input-hashes.json','stage7-qa4-progress.json':F/'progress.json','stage7-qa4-fresh-os.json':F/'fresh-os.json','stage7-qa4-safeguard.json':F/'post-acceptance/post-privacy-safeguard.json','stage7-qa4-verdict.md':S/'FINAL-QA4.md'}
 for name,source in files.items():
  b=source.read_bytes();text=b.decode()
  assert not re.search(r'AGE-SECRET-KEY-|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.',text),'Secret-shaped publication content: '+name
  (PUB/name).write_bytes(b)
 (PUB/'SHA256SUMS').write_text(''.join(v.sha(PUB/name)+'  '+name+'\n' for name in sorted(files)))
 print(json.dumps({'publicationFilesPrepared':len(files),'candidateArchiveUnchanged':True,'productionAccepted':False}))
if __name__=='__main__':main()
