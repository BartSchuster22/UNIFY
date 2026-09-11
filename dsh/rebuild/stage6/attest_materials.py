"""Sign observed image/SBOM/material provenance; explicitly NOT a build/SLSA claim."""
import json,shutil,time
from pathlib import Path
import release_trust as t
import compatibility as c
import restore_dsh2 as r
HERE=Path(__file__).parent;E=HERE/'evidence';Q=E/'qualification'
def main():
 receipt=t.load(Q/'sboms--receipt.json');assert receipt['releaseSha256']==r.RELEASE and len(receipt['images'])==8
 source=HERE.parent/'stage5/qa/evidence/dsh2-qa5/candidate-release.json';assert t.digest(source)==r.RELEASE
 base=t.load(source);ops=Path('/home/herman/.alica-release-signing/ops-candidate-1/release.json');op=t.load(ops)
 out=Path('/home/herman/.alica-release-signing/materials-attestation');out.mkdir(mode=0o700)
 shutil.copyfile(source,out/'base-release.json');shutil.copyfile(ops,out/'operations-release.json')
 subjects=[]
 for name,v in receipt['images'].items():
  if name in base['images']:assert base['images'][name]['id']==v['imageId']
  else:assert name=='reference-application' and v['imageId']=='sha256:453f59474c73eda86bdb3dcdcaebb0928bf593c86700da9a9ad2449ed52dec61'
  p=Q/v['file'];assert p.name==v['file'] and t.digest(p)==v['sha256'];d=t.load(p);assert d['spdxVersion']=='SPDX-2.3' and len(d['packages'])==v['packages']
  shutil.copyfile(p,out/p.name);subjects.append({'name':name,'digest':{'sha256':v['imageId'].split(':')[1]}})
 policy={**c.POLICY,'acceptedPredecessor':r.RELEASE,'ownerManifestSha256':r.MANIFEST,'runtimeImages':{k:v['id'] for k,v in base['images'].items()},'recoveryBoundary':'Cold local code AND data preimage; explicit process-interruption recovery; fresh-OS recovery from verified off-host encrypted backup','buildProvenanceLimit':'Original source labels are declarations; reproducible builds, upstream builder attestations and SLSA level are not asserted'}
 statement={'_type':'https://in-toto.io/Statement/v1','subject':subjects,'predicateType':'https://aquiero.com/alica/observed-materials/v1','predicate':{'observedOn':'DSH2 fresh-OS restored QA5','baseReleaseSha256':r.RELEASE,'operationsReleaseSha256':t.digest(ops),'operationsSourceRevision':op['sourceRevision'],'sourceDeclarations':base['source_revisions'],'scannerBinarySha256':receipt['generatorBinarySha256'],'scanner':receipt['generator'],'sboms':receipt['images'],'limits':policy['buildProvenanceLimit']}}
 for name,value in [('release.json',{'schema':'alica-qualified-materials/v1','baseReleaseSha256':r.RELEASE,'operationsReleaseSha256':t.digest(ops),'installable':False}),('compatibility.json',policy),('statement.json',statement)]:
  (out/name).write_bytes(t.canonical(value)+b'\n')
 files=t.inventory(out);now=int(time.time());payload={'schema':'alica-release-admission/v1','scope':'qa','sequence':1,'issuedAt':now,'expiresAt':now+86400,'platform':'linux/amd64','acceptedPredecessors':[r.RELEASE],'artifacts':files,'releaseSha256':files['release.json']}
 env=t.sign(payload,Path('/home/herman/.alica-release-signing/stage6-qa.pem'));trust=t.load(E/'qa-release-public-trust.json');verified=t.verify(env,trust,out,r.RELEASE,0,'qa')
 destination=E/'materials-attestation';shutil.copytree(out,destination);(E/'materials-envelope.json').write_bytes(t.canonical(env)+b'\n')
 report={'schema':'stage6-signed-observed-provenance/v1','passed':True,'images':len(subjects),'artifactsVerified':len(files),'signatureVerified':True,'installable':False,'attestationReleaseSha256':files['release.json'],'policyEnforcedBy':'update_ops.py before quiescence/candidate execution','claim':'Observed exact material/SBOM binding; not reproducible-build or upstream-builder provenance','wholeStage6Accepted':False};(E/'provenance-qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
