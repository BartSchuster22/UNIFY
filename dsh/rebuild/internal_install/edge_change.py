#!/usr/bin/env python3
"""Prepare (default), apply, or roll back only the approved shared Caddy edge."""
import json,subprocess,sys,hashlib,os
from pathlib import Path
ROOT=Path('/opt/alica-dev-edge');IMAGE='sha256:1b3a76433f6c1517aff303665985ff07addc39f16cf47aaa4efd633d579566cf'
SRC='/opt/unify-five-service/releases/phase-23.0-3029bc9/deploy/five-service/compose.yaml'
ENV='/opt/unify-five-service/releases/phase-23.0-3029bc9/compose.env'
def cmd(args):return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT)
def inspect(name):return json.loads(cmd(['docker','inspect',name]))[0]
def identities():
 ids=cmd(['docker','ps','-aq']).split()
 return {c['Name']:{'id':c['Id'],'started':c['State']['StartedAt'],'running':c['State']['Running'],'image':c['Image']} for c in json.loads(cmd(['docker','inspect',*ids]))}
compose=['docker','compose','--project-name','unify','--env-file',ENV,'-f',SRC]
mode=sys.argv[1] if len(sys.argv)>1 else 'prepare'
if mode=='prepare':
 assert not ROOT.exists(),'Refuse replacing rollback evidence'
 c=inspect('unify-caddy-1');assert c['Image']==IMAGE
 ROOT.mkdir(mode=0o755)
 (ROOT/'before.json').write_text(json.dumps(identities(),indent=2));(ROOT/'before.json').chmod(0o600)
 old=cmd(['docker','exec','unify-caddy-1','/bin/busybox','cat','/etc/caddy/Caddyfile'])
 assert 'dsh-dev.aquiero.com' not in old
 (ROOT/'Caddyfile.before').write_text(old)
 new=old+'\n# Dedicated ALICA internal development candidate\ndsh-dev.aquiero.com {\n encode zstd gzip\n header {\n  Strict-Transport-Security "max-age=31536000"\n  X-Content-Type-Options nosniff\n  Referrer-Policy no-referrer\n }\n reverse_proxy dsh2-internal-dev2-edge:8080\n}\n'
 (ROOT/'Caddyfile').write_text(new);(ROOT/'Caddyfile').chmod(0o644)
 override={'services':{'caddy':{'image':IMAGE,'volumes':[str(ROOT/'Caddyfile')+':/etc/caddy/Caddyfile:ro'],'networks':['unify-ingress','caddy-egress','dsh-dev-edge']}},'networks':{'dsh-dev-edge':{'external':True,'name':'dsh2-internal-dev-edge'}}}
 (ROOT/'override.json').write_text(json.dumps(override,indent=2))
 # Validate without publishing any ports or touching the running edge.
 print(cmd(['docker','run','--rm','--network','none','--entrypoint','caddy','-e','UNIFY_PUBLIC_HOST=unify.167-233-135-142.sslip.io','--tmpfs','/var/log/caddy:mode=0777','-v',str(ROOT/'Caddyfile')+':/etc/caddy/Caddyfile:ro',IMAGE,'validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']))
 resolved=json.loads(cmd(compose+['-f',str(ROOT/'override.json'),'config','--format','json']))
 service=resolved['services']['caddy'];assert service['image']==IMAGE and service['read_only'] and service['user']=='10000:10000'
 assert len(service['ports'])==2 and len(service['volumes'])==3
 print(json.dumps({'state':'prepared','imagePinned':True,'caddyConfigValidated':True,'rollback':str(ROOT),'otherServicesNotChanged':True}))
elif mode=='apply':
 baseline=json.loads((ROOT/'before.json').read_text());assert identities()['/unify-caddy-1']['id']==baseline['/unify-caddy-1']['id']
 ids=cmd(['docker','ps','-aq','--filter','label=com.docker.compose.project=dsh2-internal-dev2']).split()
 rows=json.loads(cmd(['docker','inspect',*ids]));live=[c for c in rows if c['Config']['Labels'].get('com.alica.component') in {'hermes','unify-core','uniui','caddy','postgresql','keycloak','memory-v4'}]
 assert len(live)==7 and all(c['State'].get('Health',{}).get('Status')=='healthy' for c in live),'Candidate not jointly healthy'
 print(cmd(compose+['-f',str(ROOT/'override.json'),'up','-d','--no-deps','--pull','never','--wait','--wait-timeout','90','caddy']))
 after=identities();changed=[n for n,v in baseline.items() if n!='/unify-caddy-1' and not n.startswith('/dsh2-internal-dev2-') and after.get(n)!=v]
 assert not changed,'Unexpected non-edge container change: '+str(changed)
 (ROOT/'after.json').write_text(json.dumps(after,indent=2));(ROOT/'after.json').chmod(0o600)
 print(json.dumps({'state':'edge-replaced','otherContainersUnchanged':True,'edgeImage':inspect('unify-caddy-1')['Image']}))
elif mode=='rollback':
 # Exact previous config is baked into the pinned previous image. No data volumes removed.
 rollback={'services':{'caddy':{'image':IMAGE}}};(ROOT/'rollback.json').write_text(json.dumps(rollback))
 print(cmd(compose+['-f',str(ROOT/'rollback.json'),'up','-d','--no-deps','--pull','never','--wait','--wait-timeout','90','caddy']))
else:raise SystemExit('Unknown action')
