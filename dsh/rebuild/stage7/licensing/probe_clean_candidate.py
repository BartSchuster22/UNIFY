"""Bounded image-level regression probes. NOT full stack/Stage7 acceptance.
Only separately-created new containers execute, with no network or host mounts.
"""
import json,os,socket,subprocess
from pathlib import Path
import build_clean_candidate as b
B=Path('/srv/alica-stage74-clean-candidate1')
PROBES=[
 ('caddy-version','caddy',['caddy','version']),
 ('postgres-version','postgresql',['postgres','--version']),
 ('keycloak-version','keycloak',['/opt/keycloak/bin/kc.sh','--version']),
 ('core-node','unify-core',['/nodejs/bin/node','--version']),
 ('core-syntax','unify-core',['/nodejs/bin/node','--check','dist/server.js']),
 ('ui-syntax','uniui',['/nodejs/bin/node','--check','server.mjs']),
 ('memory-import','memory-v4',['python','-c','import app.main; print("MemoryV4 application import OK")']),
 ('reference-syntax','reference-application',['python','-c','import ast,pathlib; ast.parse(pathlib.Path("app.py").read_text()); print("Reference application syntax OK")']),
 ('hermes-python','hermes',['/opt/hermes/.venv/bin/python','--version']),
 ('hermes-node','hermes',['/usr/local/bin/node','--version']),
 ('hermes-uv','hermes',['/usr/local/bin/uv','--version']),
 ('hermes-agent-browser','hermes',['/opt/hermes/node_modules/.bin/agent-browser','--version']),
 ('hermes-imports','hermes',['/opt/hermes/.venv/bin/python','-c','import pathlib; assert not pathlib.Path("/opt/hermes/plugins/platforms/photon").exists(); import discord,olm,run_agent; print("Retained Hermes/Discord/Olm imports OK; Photon absent")']),
]
def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2':raise ValueError('Wrong host')
    before=b.canonical_snapshot(json.loads((B/'original-containers.private.json').read_bytes()))
    if b.container_snapshot()!=before:raise ValueError('Original QA changed or other containers running')
    verify=json.loads((B/'build-verification.json').read_bytes());scan=json.loads((B/'scans/receipt.json').read_bytes())
    if not verify.get('buildComplete') or not scan.get('completed'):raise ValueError('Build/scan unfinished')
    build=json.loads((B/'build-receipt.json').read_bytes())
    if verify['buildReceiptSha256']!=b.sha(B/'build-receipt.json'):raise ValueError('Changed build receipt')
    out=B/'runtime-probes';out.mkdir(mode=0o700,exist_ok=False);rows=[]
    for name,role,command in PROBES:
        image=build['images'][role]['imageId'];container='stage74-clean-probe-'+name
        if subprocess.run(['docker','container','inspect',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:raise ValueError('Probe name collision')
        args=['docker','create','--name',container,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','768m','--cpus','1','--tmpfs','/tmp:rw,nosuid,nodev,size=128m','-e','HOME=/tmp/home','-e','HERMES_HOME=/tmp/hermes','-e','PYTHONDONTWRITEBYTECODE=1','--entrypoint',command[0],image,*command[1:]]
        cid=b.cmd(args).strip();row={'name':name,'imageId':image,'network':'none','hostMounts':False,'command':command,'passed':False}
        try:
            p=subprocess.run(['docker','start','--attach',cid],capture_output=True,text=True,timeout=180)
            (out/(name+'.log')).write_text(p.stdout+'\n'+p.stderr)
            state=json.loads(b.cmd(['docker','inspect',cid]))[0]['State']
            row.update(exitCode=state['ExitCode'],oomKilled=state['OOMKilled'],passed=p.returncode==0 and state['ExitCode']==0 and not state['OOMKilled'],logSha256=b.sha(out/(name+'.log')))
        except subprocess.TimeoutExpired:row['error']='Probe timeout'
        finally:b.cmd(['docker','rm','--force','--volumes',cid])
        rows.append(row);print(json.dumps(row),flush=True)
    if b.container_snapshot()!=before:raise ValueError('Original QA facts changed')
    result={'schema':'stage74-clean-image-probes/v1','buildVerificationSha256':b.sha(B/'build-verification.json'),'results':rows,'allImageProbesPassed':all(r['passed'] for r in rows),'originalQAUnchanged':True,'fullStackRequalified':False,'engineeringComplete':False}
    b.js(out/'report.json',result);print(json.dumps({k:v for k,v in result.items() if k!='results'}),flush=True)
    if not result['allImageProbesPassed']:raise SystemExit(2)
if __name__=='__main__':main()
