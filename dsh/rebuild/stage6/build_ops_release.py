"""Build a signed QA-only host-operations candidate from the committed Doghouse source."""
import argparse,json,shutil,subprocess,time
from pathlib import Path
import release_trust as t
import restore_dsh2 as r

def main():
 p=argparse.ArgumentParser();p.add_argument('--sequence',type=int,required=True);p.add_argument('--predecessor',required=True);a=p.parse_args()
 repo=Path('/home/herman/stage5-publication/repos/Doghouse');assert not subprocess.check_output(['git','-C',str(repo),'status','--porcelain'],text=True).strip()
 revision=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
 root=Path('/home/herman/.alica-release-signing');out=root/('ops-candidate-'+str(a.sequence));out.mkdir(mode=0o700)
 pkg=out/'doghouse_dsh';pkg.mkdir()
 for f in (repo/'dsh/doghouse_dsh').glob('*.py'):shutil.copyfile(f,pkg/f.name)
 release=t.load(Path(__file__).parent.parent/'stage5/qa/evidence/dsh2-qa5/candidate-release.json');assert t.digest(Path(__file__).parent.parent/'stage5/qa/evidence/dsh2-qa5/candidate-release.json')==r.RELEASE
 desc={'schema':'alica-qa5-host-operations-release/v1','sourceRevision':revision,'baseReleaseSha256':r.RELEASE,'runtimeImages':{s:v['id'] for s,v in release['images'].items()},'mapping':{'identities':'preserve','channels':'preserve','schedules':'preserve'},'targetSignatureSchema':'alica-runtime-identity/v2','platform':'ubuntu-26.04/docker-29.1.3/overlay2/linux-amd64'}
 (out/'release.json').write_bytes(t.canonical(desc)+b'\n');files=t.inventory(out);now=int(time.time())
 payload={'schema':'alica-release-admission/v1','scope':'qa','sequence':a.sequence,'issuedAt':now,'expiresAt':now+86400,'platform':'linux/amd64','acceptedPredecessors':[a.predecessor],'artifacts':files,'releaseSha256':files['release.json']}
 envelope=t.sign(payload,root/'stage6-qa.pem');ep=root/('ops-envelope-'+str(a.sequence)+'.json');ep.write_bytes(t.canonical(envelope)+b'\n')
 print(json.dumps({'bundle':str(out),'envelope':str(ep),'releaseSha256':files['release.json'],'sourceRevision':revision,'artifacts':len(files),'sequence':a.sequence}))
if __name__=='__main__':main()
