#!/usr/bin/env python3
"""Pinned-bundle Stage 2 candidate driver. No source checkout or build on target."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import socket
import signal
import subprocess
import time
from transaction import Transaction,TransactionError,atomic_json,atomic_json
from render import validate_request,realm,caddyfile,apply_tls
from tls_lifecycle import ensure as ensure_pki

SERVICES={'postgresql','keycloak','memory-v4','hermes','unify-core','uniui','caddy'}
KEYS={'hermes':'ALICA_RUNTIME_IMAGE','unify-core':'UNIFY_CORE_IMAGE','uniui':'UNIUI_IMAGE','memory-v4':'MEMORY_V4_IMAGE','postgresql':'POSTGRESQL_IMAGE','keycloak':'KEYCLOAK_IMAGE','caddy':'CADDY_IMAGE'}

def sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def command(args,timeout=300):
    p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    # Never put upstream command bodies, SQL errors or credential-bearing output in receipts.
    if p.returncode:raise TransactionError('Candidate command failed: '+args[0]+' (exit '+str(p.returncode)+')')
    return p.stdout.strip()

class Installer:
    def __init__(self,bundle,expected,root,request):
        self.bundle=Path(bundle).resolve();self.root=Path(root).absolute();self.r=request;validate_request(request)
        if self.root.name!=request['cell']:raise TransactionError('Root basename must equal dedicated cell name')
        release=self.bundle/'release.json'
        if release.is_symlink() or sha(release)!=expected:raise TransactionError('Release checksum mismatch')
        self.release=json.loads(release.read_text())
        if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,100}',self.release.get('release','')):raise TransactionError('Invalid release identifier')
        if self.release.get('schema')!='dsh-stage2-bundle/v1' or set(self.release.get('images',{}))!=SERVICES:raise TransactionError('Unsupported release')
        for image in self.release['images'].values():
            if not re.fullmatch(r'sha256:[a-f0-9]{64}',image.get('id','')):raise TransactionError('Unpinned image')
        for name,digest in self.release['files'].items():
            p=self.bundle/name
            if Path(name).name!=name or name in {'.','..'} or p.is_symlink() or not p.is_file() or sha(p)!=digest:raise TransactionError('Bundle integrity failure')
        if not {'compose.template.json','frameworks.json','render.py','transaction.py','install.py'}<=set(self.release['files']):raise TransactionError('Incomplete deployment bundle')
        self.tx=Transaction(self.root,request,self.release);self.deadline=time.monotonic()+900

    def docker(self,*args,safety=False):return command(['docker',*args],timeout=90 if safety else max(1,min(300,int(self.deadline-time.monotonic()))))
    def records(self):
        ids=self.docker('ps','-aq','--filter','label=com.docker.compose.project='+self.r['cell']).split()
        return json.loads(self.docker('inspect',*ids)) if ids else []
    def owned(self):
        records=self.records()
        if any(c['Config'].get('Labels',{}).get('com.alica.stage2')!=self.r['cell'] for c in records):raise TransactionError('Foreign resource in candidate namespace')
        return records
    def compose(self,*args):
        self.owned()
        return self.docker('compose','--project-name',self.r['cell'],'--project-directory',str(self.root),'-f',str(self.root/'compose.json'),*args,safety=bool(args and args[0]=='stop'))
    def plan(self):
        state=self.tx.inspect()
        if state['state']=='absent' and self.records():raise TransactionError('Candidate namespace already occupied')
        for kind in ['volume','network']:
            names=self.docker(kind,'ls','-q','--filter','label=com.docker.compose.project='+self.r['cell']).split()
            if state['state']=='absent' and names:raise TransactionError('Candidate namespace has existing data/network resources')
        if shutil.disk_usage(self.root.parent).free<8*1024**3:raise TransactionError('Less than 8 GiB free disk')
        missing=[]
        for record in self.release['images'].values():
            try:
                if self.docker('image','inspect',record['id'],'--format','{{.Id}}')!=record['id']:missing.append(record['id'])
            except TransactionError:missing.append(record['id'])
        if missing and 'images.tar' not in self.release['files']:raise TransactionError('Missing pinned image archive')
        if state['state']=='absent':
            mem=next(int(x.split()[1])*1024 for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:'))
            if mem<4*1024**3:raise TransactionError('Less than 4 GiB available memory')
            if self.r.get('tls_mode')!='proxy':
                for port in ([80,443] if self.r.get('tls_mode')=='acme' else [self.r['port']]):
                    with socket.socket() as sock:sock.bind((self.r['bind'],port))
            else:
                self.docker('network','inspect',self.r['edge_network'])
        return {'schema':'dsh-stage2-plan/v1','state':state['state'],'cell':self.r['cell'],'release_sha256':sha(self.bundle/'release.json'),'mutations':False,'images_to_load':missing}
    def prepare(self):
        s=self.root/'secrets'
        if s.is_symlink():raise TransactionError('Unsafe secrets directory')
        s.mkdir(mode=0o700,exist_ok=True)
        def text(name,value,mode=0o444):
            p=self.root/name
            if p.is_symlink():raise TransactionError('Symlink in candidate files')
            if p.exists():
                if p.read_text()!=value:raise TransactionError('Prepared configuration changed')
            else:
                fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
                with os.fdopen(fd,'w') as f:f.write(value);f.flush();os.fsync(f.fileno())
        values={}
        for name in ['postgres-password','core-database-password','keycloak-database-password','keycloak-admin-password','alica-database-password','auth-pepper','memory-v4-token','alica-api-token','alica-token','oidc-client-secret','owner-password']:
            p=s/name
            if p.is_symlink():raise TransactionError('Symlink in candidate secrets')
            if not p.exists():text('secrets/'+name,secrets.token_hex(36)+'\n',0o400 if name=='owner-password' else 0o444)
            values[name]=p.read_text().strip()
        text('secrets/core-database-url','postgresql://unify:'+values['core-database-password']+'@postgresql:5432/unify\n')
        text('secrets/migration-database-url','postgresql://unify_bootstrap:'+values['postgres-password']+'@postgresql:5432/unify\n')
        text('secrets/alica-database-url','postgresql://unify_alica_adapter:'+values['alica-database-password']+'@postgresql:5432/unify\n')
        text('secrets/alica-token-bundle.json',json.dumps({'active':{'version':'dsh-stage2','token':values['alica-token']}})+'\n')
        text('secrets/realm.json',json.dumps(realm(self.r,values['oidc-client-secret'],values['owner-password'])))
        text('postgres-init.sql',"CREATE ROLE unify LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+values['core-database-password']+"';\n"+"CREATE ROLE keycloak LOGIN PASSWORD '"+values['keycloak-database-password']+"';\nCREATE DATABASE keycloak OWNER keycloak;\nCREATE ROLE unify_alica_adapter LOGIN PASSWORD '"+values['alica-database-password']+"';\n")
        u=validate_request(self.r)
        ensure_pki(s,u.hostname)
        env={'ALICA_PROJECT':self.r['cell'],'ALICA_CELL_ID':self.r['cell'],'ALICA_RELEASE_ID':self.release['release'],'ALICA_PUBLIC_HOST':u.hostname,'ALICA_PUBLIC_ORIGIN':self.r['origin'],'KEYCLOAK_ADMIN_USERNAME':'recovery-admin'}
        for name,key in KEYS.items():env[key]=self.release['images'][name]['id']
        env['DSH_HERMES_OCI_REF']=self.release['images']['hermes']['oci_reference']
        text('.env',''.join(k+'='+v+'\n' for k,v in env.items()),0o600)
        d=json.loads((self.bundle/'compose.template.json').read_text())
        substitutions={'dsh2-template':self.r['cell'],'org:dsh2-template':'org:'+self.r['cell'],'stage2.dsh.invalid':u.hostname,'https://stage2.dsh.invalid:19443':self.r['origin'],'https://stage2.dsh.invalid:19443/identity':self.r['origin']+'/identity','https://stage2.dsh.invalid:19443/identity/realms/alica':self.r['origin']+'/identity/realms/alica'}
        def walk(v):
            if isinstance(v,str):return substitutions.get(v,v)
            if isinstance(v,list):return [walk(x) for x in v]
            if isinstance(v,dict):return {k:walk(x) for k,x in v.items()}
            return v
        d=walk(d);d['services']['caddy']['ports'][0].update(published=str(self.r['port']),host_ip=self.r['bind'])
        apply_tls(d,self.r)
        for service in d['services'].values():service['pull_policy']='never'
        text('compose.json',json.dumps(d,indent=2));text('frameworks.json',(self.bundle/'frameworks.json').read_text());text('Caddyfile',caddyfile(self.r))
    def stop(self):
        if (self.root/'compose.json').exists():
            self.compose('stop','--timeout','30')
            if any(c['State']['Running'] for c in self.owned()):raise TransactionError('Candidate did not stop')
    def uninstall(self):
        self.operator()
        if self.tx.inspect()['state']=='absent':raise TransactionError('Installation does not exist')
        with self.tx.locked():
            old=self.tx.inspect();self.owned()
            if old['state'] in {'installed','uninstalled-data-retained'}:self.prepare()
            def resources(kind):
                names=self.docker(kind,'ls','-q','--filter','label=com.docker.compose.project='+self.r['cell']).split()
                rows=json.loads(self.docker(kind,'inspect',*names)) if names else []
                if any((row.get('Labels') or {}).get('com.alica.stage2')!=self.r['cell'] for row in rows):raise TransactionError('Foreign '+kind+' in candidate namespace')
                return {row['Name'] for row in rows}
            retained=resources('volume');resources('network')
            if (self.root/'compose.json').exists():self.compose('down','--timeout','30')
            if self.records() or resources('network'):raise TransactionError('Candidate resources remain after uninstall')
            if resources('volume')!=retained:raise TransactionError('Uninstall volume retention check failed')
            atomic_json(self.tx.journal,{'state':'uninstalled-data-retained','completed':old.get('completed',[])})
            return {'state':'uninstalled-data-retained','containers_removed':True,'networks_removed':True,'data_retained':True,'retained_volume_count':len(retained)}
    def load_images(self):
        missing=self.plan()['images_to_load']
        if missing:self.docker('load','--input',str(self.bundle/'images.tar'))
        for record in self.release['images'].values():
            if self.docker('image','inspect',record['id'],'--format','{{.Id}}')!=record['id']:raise TransactionError('Loaded image identity mismatch')
    def operator(self):
        if os.geteuid()!=0:raise TransactionError('Root operator required')
        for path in [self.root,*self.root.parents]:
            if path.exists() and (path.stat().st_uid!=0 or path.stat().st_mode&0o022):raise TransactionError('Root-owned non-writable installation ancestry required')
    def start(self):
        self.operator();self.plan()
        if self.tx.inspect()['state'] not in {'installed','uninstalled-data-retained'}:raise TransactionError('Completed installation required; use install to recover a failed transaction')
        with self.tx.locked():
            try:
                self.prepare();self.compose('up','-d','--wait','--wait-timeout','240')
                records=[c for c in self.owned() if c['Config']['Labels'].get('com.alica.component') in SERVICES]
                if len(records)!=7 or any(not c['State']['Running'] or c['State'].get('Health',{}).get('Status')!='healthy' for c in records):raise TransactionError('Candidate joint health failed')
                old=self.tx.inspect();atomic_json(self.tx.journal,{'state':'installed','completed':old.get('completed',[])})
            except BaseException:
                self.stop();raise
        return {'state':'installed','runtime_health':'healthy','model_setup':'not_evaluated','production_ready':False}
    def install(self):
        self.operator()
        if self.tx.inspect()['state'] in {'installed','uninstalled-data-retained'}:return self.start()
        self.plan()
        steps=[('images',self.load_images),('prepare',self.prepare),('config',lambda:self.compose('config','--quiet')),
          ('database',lambda:self.compose('up','-d','--wait','--wait-timeout','120','postgresql')),
          ('migrate',lambda:self.compose('--profile','jobs','run','--rm','--no-deps','migrate')),
          ('runtime-grants',lambda:self.docker('exec',self.r['cell']+'-postgresql-1','psql','-v','ON_ERROR_STOP=1','-U','unify_bootstrap','-d','unify','-c','GRANT USAGE ON SCHEMA public TO unify; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO unify; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO unify;')),
          ('authorities',lambda:self.compose('up','-d','--wait','--wait-timeout','240','hermes','memory-v4','keycloak')),
          ('register',lambda:self.compose('--profile','jobs','run','--rm','--no-deps','reconcile-frameworks')),
          ('application',lambda:self.compose('up','-d','--wait','--wait-timeout','240'))]
        result=self.tx.execute(steps,self.stop)
        return {**result,'model_setup':'required','production_ready':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['plan','install','start','stop','uninstall']);p.add_argument('--bundle',required=True);p.add_argument('--release-sha256',required=True);p.add_argument('--root',required=True);p.add_argument('--request',required=True);a=p.parse_args()
    i=Installer(a.bundle,a.release_sha256,a.root,json.loads(Path(a.request).read_text()))
    if a.action=='plan':result=i.plan()
    elif a.action=='install':result=i.install()
    elif a.action=='start':result=i.start()
    elif a.action=='uninstall':result=i.uninstall()
    else:
        if os.geteuid()!=0:raise TransactionError('Root operator required')
        with i.tx.locked():i.stop()
        result={'state':'stopped','data_retained':True}
    print(json.dumps(result))
if __name__=='__main__':
    def interrupted(*_):raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,interrupted)
    try:main()
    except Exception as e:raise SystemExit(type(e).__name__+': '+str(e))
