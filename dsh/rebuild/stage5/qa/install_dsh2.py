import hashlib,json,os,socket,subprocess,sys,time
from pathlib import Path
assert os.geteuid()==0 and socket.gethostname()=='DSH2'
import argparse
a=argparse.ArgumentParser();a.add_argument('--cell',choices=['qa4','qa5'],required=True);a.add_argument('--sha',required=True);v=a.parse_args()
b=Path('/srv/alica-dsh-qa/stage5-package-'+v.cell);root=Path('/opt/dsh2-stage5-'+v.cell);out=Path('/var/lib/alica-stage5-'+v.cell)
h=v.sha
assert not root.exists() and not out.exists()
assert hashlib.sha256((b/'release.json').read_bytes()).hexdigest()==h
sys.path.insert(0,str(b));from install import Installer
r={'cell':root.name,'origin':'https://stage5.qa.invalid','port':443,'bind':'127.0.0.1','owner':'stage5-owner'}
i=Installer(b,h,str(root),r);i.operator();plan=i.plan()
assert not subprocess.check_output(['docker','ps','-aq']).strip()
out.mkdir(mode=0o700);req=out/'request.json';req.write_text(json.dumps(r));req.chmod(0o600)
report={'schema':'stage5-dsh2-install/v1','releaseSha256':h,'plan':plan,'freshInstallAttempt':True,'imagesPreexisting':True,'wholeStage5Accepted':False}
print(json.dumps({'bundleVerified':True,'plan':plan}),flush=True)
start=time.monotonic()
with (out/'private-install.log').open('w') as log:
 os.chmod(log.name,0o600)
 p=subprocess.run(['python3',str(b/'ops.py'),'install','--bundle',str(b),'--release-sha256',h,'--root',str(root),'--request',str(req)],stdout=log,stderr=subprocess.STDOUT,timeout=1800)
report['installExit']=p.returncode;report['seconds']=round(time.monotonic()-start,3)
report['transaction']=json.loads((root/'transaction.json').read_text()) if (root/'transaction.json').exists() else None
report['operationsEnrolled']=(root/'operations/broker.json').is_file()
(out/'dsh2-install.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
assert p.returncode==0 and report['operationsEnrolled'],'installation-or-enrollment-failed; private log retained'
