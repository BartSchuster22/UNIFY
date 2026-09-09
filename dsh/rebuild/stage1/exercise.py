#!/usr/bin/env python3
"""Bounded Stage 1 exercise. Root operator, fresh namespace, no production operations.
Always stops candidate containers; preserves candidate-only data and root-private secrets.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
from render import CPUS, CAPS_MIB
import shutil
import signal
import subprocess
import sys
import threading
import time
from admission import admission, observe, GIB

ROOT=Path('/srv/dsh-stage1-candidate')
PROJECT='dsh-stage1'
REPORT={'schema':'dsh-stage1-exercise/v1','started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':{},'samples':[],'pass':False}
SECRET_VALUES=[]
ABORTED=threading.Event()


def run(args, timeout=180):
    p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        out=p.stdout+'\n'+p.stderr
        for value in SECRET_VALUES: out=out.replace(value,'[REDACTED]')
        raise RuntimeError(' '.join(args[:5])+' failed: '+out[-5000:])
    return p.stdout.strip()


def compose(*args):
    if ABORTED.is_set() and args[0] not in ['stop','config','ps']:
        raise RuntimeError('candidate operation blocked by safety guard')
    return run(['docker','compose','--project-name',PROJECT,'--project-directory',str(ROOT),'-f',str(ROOT/'compose.json'),*args],timeout=300)


def inventory(exclude_candidate=True):
    ids=run(['docker','ps','-aq']).split()
    result=[]
    for c in json.loads(run(['docker','inspect',*ids])) if ids else []:
        if exclude_candidate and c['Config'].get('Labels',{}).get('com.docker.compose.project')==PROJECT: continue
        result.append({'id':c['Id'],'name':c['Name'],'image':c['Image'],'started_at':c['State']['StartedAt'],
            'status':c['State']['Status'],'health':c['State'].get('Health',{}).get('Status'),
            'mounts':sorted([{k:m.get(k) for k in ['Type','Source','Destination','RW','Name']} for m in c['Mounts']],key=lambda m:json.dumps(m,sort_keys=True)),
            'networks':sorted(c['NetworkSettings']['Networks']), 'ports':c['HostConfig'].get('PortBindings')})
    return sorted(result,key=lambda c:c['id'])


def prepare(package,d,lock):
    ROOT.mkdir(mode=0o700)
    (ROOT/'secrets').mkdir(mode=0o700)
    values={name:secrets.token_hex(36) for name in ['postgres-password','keycloak-database-password','keycloak-admin-password','alica-database-password','auth-pepper','bootstrap-admin-password','memory-v4-token','alica-api-token','alica-token']}
    values['core-database-url']='postgresql://unify:'+values['postgres-password']+'@postgresql:5432/unify'
    values['alica-database-url']='postgresql://unify_alica_adapter:'+values['alica-database-password']+'@postgresql:5432/unify'
    values['alica-token-bundle.json']=json.dumps({'active':{'version':'dsh-stage1','token':values['alica-token']}})
    SECRET_VALUES.extend(values.values())
    for name,value in values.items():
        p=ROOT/'secrets'/name;p.write_text(value+'\n');p.chmod(0o444)
    s=ROOT/'secrets'
    run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','30','-subj','/CN=DSH Stage1 Private Test CA','-keyout',str(s/'framework-ca.key'),'-out',str(s/'framework-ca.crt')])
    for stem,dns in [('alica','hermes-adapter'),('edge','stage1.dsh.invalid')]:
        run(['openssl','req','-newkey','rsa:2048','-nodes','-subj','/CN='+dns,'-keyout',str(s/(stem+'.key')),'-out',str(s/(stem+'.csr'))])
        ext=s/(stem+'.ext');ext.write_text('subjectAltName=DNS:'+dns+'\nextendedKeyUsage=serverAuth\n')
        run(['openssl','x509','-req','-in',str(s/(stem+'.csr')),'-CA',str(s/'framework-ca.crt'),'-CAkey',str(s/'framework-ca.key'),'-CAcreateserial','-days','30','-sha256','-extfile',str(ext),'-out',str(s/(stem+'.crt'))])
        for suffix in ['.crt','.key']:(s/(stem+suffix)).chmod(0o444)
    (s/'framework-ca.crt').chmod(0o444)
    sql="CREATE ROLE keycloak LOGIN PASSWORD '"+values['keycloak-database-password']+"';\nCREATE DATABASE keycloak OWNER keycloak;\nCREATE ROLE unify_alica_adapter LOGIN PASSWORD '"+values['alica-database-password']+"';\n"
    (ROOT/'postgres-init.sql').write_text(sql);(ROOT/'postgres-init.sql').chmod(0o444)
    env={'ALICA_PROJECT':PROJECT,'ALICA_CELL_ID':'ins_dsh_stage1','ALICA_RELEASE_ID':'dsh-stage1','ALICA_PUBLIC_HOST':'stage1.dsh.invalid','ALICA_PUBLIC_ORIGIN':'https://stage1.dsh.invalid:18443','ALICA_ALLOWED_ORIGINS':'https://stage1.dsh.invalid:18443','BOOTSTRAP_ADMIN_USERNAME':'stage1-admin','KEYCLOAK_ADMIN_USERNAME':'stage1-admin'}
    keys={'hermes':'ALICA_RUNTIME_IMAGE','unify-core':'UNIFY_CORE_IMAGE','uniui':'UNIUI_IMAGE','memory-v4':'MEMORY_V4_IMAGE','postgresql':'POSTGRESQL_IMAGE','keycloak':'KEYCLOAK_IMAGE','caddy':'CADDY_IMAGE'}
    for name,key in keys.items():env[key]=lock['images'][name]['id']
    (ROOT/'.env').write_text('\n'.join(k+'='+v for k,v in env.items())+'\n')
    # Resolve the generated template without allowing mutable image pulls.
    for service in d['services'].values():service['pull_policy']='never'
    (ROOT/'compose.json').write_text(json.dumps(d,indent=2))
    for f in ['frameworks.json','acceptance-client.mjs']:
        shutil.copyfile(package/f,ROOT/f);(ROOT/f).chmod(0o444)
    (ROOT/'Caddyfile').write_text('https://stage1.dsh.invalid:8443 {\n tls /run/secrets/edge.crt /run/secrets/edge.key\n reverse_proxy uniui:3000\n}\n')
    (ROOT/'Caddyfile').chmod(0o444)
    (ROOT/'.stage1-owner.json').write_text(json.dumps({'project':PROJECT,'image_lock_sha256':hashlib.sha256((package/'images.lock.json').read_bytes()).hexdigest(),'scope':'Stage1 engineering candidate; stopped after test'}))
    (ROOT/'images.lock.json').write_text(json.dumps(lock,indent=2))


def candidate_ids(steady_only=False):
    # Setup jobs are --rm; observing their removal races with docker inspect.
    # Their own synchronous exit status is checked by compose().
    args=['docker','ps','-aq','--filter',f'label=com.docker.compose.project={PROJECT}']
    if steady_only:args.extend(['--filter','label=com.docker.compose.oneoff=False'])
    return run(args).split()


def state(steady_only=False):
    ids=candidate_ids(steady_only)
    return json.loads(run(['docker','inspect',*ids])) if ids else []


def check_runtime():
    records=state(steady_only=True)
    live=[c for c in records if c['State']['Running']]
    REPORT['checks']['seven_healthy_services']=len(live)==7 and all(c['State'].get('Health',{}).get('Status')=='healthy' for c in live)
    assert REPORT['checks']['seven_healthy_services'], 'not all seven services healthy'
    for c in live:
        assert c['HostConfig']['ReadonlyRootfs'] and not c['HostConfig']['Privileged']
        assert c['HostConfig']['Memory']>0 and c['HostConfig']['MemorySwap']==c['HostConfig']['Memory']
        service=c['Config']['Labels']['com.docker.compose.service']
        assert c['HostConfig']['Memory']==CAPS_MIB[service]*1024**2
        assert c['HostConfig']['NanoCpus']==int(CPUS[service]*10**9)
        assert 0<c['HostConfig']['PidsLimit']<=192
        assert 'ALL' in c['HostConfig']['CapDrop']
        assert 'no-new-privileges:true' in c['HostConfig']['SecurityOpt']
        assert not c['State']['OOMKilled']
        for m in c['Mounts']:
            assert (m['Type']=='volume' and m['Name'].startswith(PROJECT+'_')) or (m['Type']=='bind' and m['Source'].startswith(str(ROOT)+'/')), m
        assert all(n.startswith(PROJECT+'_') for n in c['NetworkSettings']['Networks'])
        for bindings in (c['HostConfig'].get('PortBindings') or {}).values():
            assert all(p['HostIp']=='127.0.0.1' and p['HostPort']=='18443' for p in bindings)
    REPORT['checks']['effective_isolation_and_caps']=True
    REPORT['candidate_inventory']=[{'name':c['Name'],'image':c['Image'],'service':c['Config']['Labels']['com.docker.compose.service'],'memory_limit':c['HostConfig']['Memory'],'nano_cpus':c['HostConfig']['NanoCpus'],'pids_limit':c['HostConfig']['PidsLimit'],'networks':sorted(c['NetworkSettings']['Networks']),'health':c['State'].get('Health',{}).get('Status')} for c in live]
    return {c['Config']['Labels']['com.docker.compose.service']:c['Id'] for c in live}


def main(package):
    if os.geteuid()!=0: raise RuntimeError('root operator required')
    d=json.loads((package/'compose.template.json').read_text());lock=json.loads((package/'images.lock.json').read_text())
    host=observe();gate=admission(host,d,lock)
    REPORT['admission']={'host':host,'decision':gate}
    if not gate['pass']: raise RuntimeError('admission rejected: '+str(gate['checks']))
    for img in lock['images'].values():
        assert run(['docker','image','inspect',img['id'],'--format','{{.Id}}'])==img['id'], 'image identity mismatch'
    before=inventory();REPORT['production_before']=before
    REPORT['checks']['admission_before_deployment']=True
    prepare(package,d,lock)
    compose('config','--quiet')
    done=threading.Event();fault=[]
    def guard():
        started=time.monotonic()
        while not done.wait(2):
            mem=next(int(l.split()[1])*1024 for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))
            disk=shutil.disk_usage('/srv').free
            REPORT['samples'].append({'at':time.monotonic()-started,'available_memory_bytes':mem,'free_disk_bytes':disk})
            try:
                if mem<GIB or disk<8*GIB or time.monotonic()-started>900:
                    raise RuntimeError('resource/TTL guard tripped')
                if any(c['State'].get('OOMKilled') for c in state(steady_only=True)):
                    raise RuntimeError('candidate container exceeded memory cap')
                if len(REPORT['samples']) % 5 == 0:
                    code=run(['curl','--max-time','8','--silent','--show-error','--output','/dev/null','--write-out','%{http_code}','https://uniui.aquiero.com/'],timeout=10)
                    REPORT.setdefault('existing_ui_during',[]).append({'at':time.monotonic()-started,'http_status':code})
                    if code!='200':raise RuntimeError('existing UI health changed')
            except Exception as exc:
                fault.append(str(exc));ABORTED.set()
                REPORT['guard_faults']=fault
                try:compose('stop','--timeout','20')
                except Exception as stop_error:REPORT['guard_stop_error']=str(stop_error)
                return
    thread=threading.Thread(target=guard,daemon=True);thread.start()
    try:
        compose('up','-d','--wait','--wait-timeout','120','postgresql')
        for job in ['migrate','bootstrap-admin']:
            compose('--profile','jobs','run','--rm','--no-deps',job)
        compose('up','-d','--wait','--wait-timeout','240','hermes','memory-v4','keycloak')
        compose('--profile','jobs','run','--rm','--no-deps','reconcile-frameworks')
        compose('up','-d','--wait','--wait-timeout','240')
        assert not fault
        ids=check_runtime()
        # Authenticate adapter, version/source, projects and conversation APIs;
        # check its native CLI agreement, UID drop, supervision and loopback binding.
        REPORT['native_adapter_acceptance']=run(['docker','exec',ids['hermes'],'/usr/local/bin/node','/run/acceptance-client.mjs'])
        REPORT['checks']['native_adapter_acceptance']=True
        REPORT['native_profiles']=run(['docker','exec','--user','10000:10000',ids['hermes'],'/opt/hermes/bin/hermes','profile','list'])
        REPORT['native_cron']=run(['docker','exec','--user','10000:10000',ids['hermes'],'/opt/hermes/bin/hermes','cron','list'])
        REPORT['native_kanban']=run(['docker','exec','--user','10000:10000',ids['hermes'],'/opt/hermes/bin/hermes','kanban','list'])
        REPORT['checks']['native_profile_cron_kanban_cli']=True
        REPORT['memory_from_core']=run(['docker','exec',ids['unify-core'],'node','--input-type=module','-e',"const r=await fetch('http://memory-v4:8000/health',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Memory health HTTP '+r.status);console.log(await r.text());"])
        REPORT['checks']['private_core_memory_reachability']=True
        code=run(['curl','--silent','--show-error','--noproxy','*','--cacert',str(ROOT/'secrets/framework-ca.crt'),'--resolve','stage1.dsh.invalid:18443:127.0.0.1','--output','/dev/null','--write-out','%{http_code}','https://stage1.dsh.invalid:18443/'])
        assert code=='200',code
        REPORT['checks']['private_tls_ui_200']=True
        REPORT['resource_stats']=run(['docker','stats','--no-stream','--format','{{json .}}',*ids.values()]).splitlines()
        compose('stop','--timeout','30')
        assert not any(c['State']['Running'] for c in state())
        REPORT['checks']['first_stop']=True
        compose('up','-d','--wait','--wait-timeout','240')
        ids2=check_runtime()
        project=run(['docker','exec',ids2['hermes'],'/opt/hermes/bin/hermes','project','show','phase-14-1-fixture'])
        assert 'Phase 14.1 isolated fixture' in project
        REPORT['checks']['restart_retains_native_project']=True
        assert not fault
        REPORT['checks']['resource_guard_not_triggered']=True
    finally:
        done.set();thread.join(timeout=5)
        REPORT['candidate_before_final_stop']=[{'name':c['Name'],'state':c['State']['Status'],'oom_killed':c['State'].get('OOMKilled'),'health':c['State'].get('Health',{}).get('Status')} for c in state()]
        compose('stop','--timeout','30')
        remaining=[c['Id'] for c in state() if c['State']['Running']]
        if remaining:run(['docker','stop','--time','30',*remaining])
        REPORT['checks']['final_candidate_stopped']=not any(c['State']['Running'] for c in state())
        after=inventory();REPORT['production_after']=after
        REPORT['checks']['existing_workloads_unchanged']=before==after
        REPORT['checks']['existing_ui_https_200']=run(['curl','--silent','--show-error','--output','/dev/null','--write-out','%{http_code}','https://uniui.aquiero.com/'])=='200'
    REPORT['pass']=all(REPORT['checks'].values())


if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try: main(Path(sys.argv[1]))
    except BaseException as exc:
        REPORT['failure']=str(exc);REPORT['pass']=False
    REPORT['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    out=json.dumps(REPORT,indent=2)
    for secret in SECRET_VALUES:out=out.replace(secret,'[REDACTED]')
    if ROOT.exists():(ROOT/'exercise-result.json').write_text(out)
    print(out)
    raise SystemExit(0 if REPORT['pass'] else 1)
