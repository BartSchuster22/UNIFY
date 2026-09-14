"""Build-time renderer; emitted JSON is deployed without a source checkout."""
import importlib.util
from pathlib import Path
from urllib.parse import urlsplit
import re


def validate_request(r):
    required={'cell','origin','port','bind','owner'}
    if not required<=set(r) or set(r)-required-{'tls_mode','edge_network'}:raise ValueError('Unexpected or missing installation request fields')
    mode=r.get('tls_mode','engineering')
    if mode not in {'engineering','acme','proxy'}:raise ValueError('Unknown TLS mode')
    if mode!='engineering' and (r['port']!=443 or r['origin'].endswith(':443')):raise ValueError('Managed TLS requires canonical HTTPS port 443')
    if mode=='proxy':
        if not re.fullmatch(r'dsh2-[a-z0-9-]{3,40}-edge',r.get('edge_network','')):raise ValueError('Dedicated proxy edge network required')
    elif 'edge_network' in r:raise ValueError('Edge network is only valid in proxy mode')
    if not re.fullmatch(r'dsh2-[a-z0-9-]{3,40}',r['cell']):raise ValueError('Dedicated Stage 2 cell namespace required')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{3,64}',r['owner']):raise ValueError('Invalid owner name')
    u=urlsplit(r['origin'])
    if u.scheme!='https' or u.username or u.password or u.path or u.query or u.fragment or not re.fullmatch(r'[a-z0-9.-]+',u.hostname or ''):raise ValueError('Canonical HTTPS origin required')
    if type(r['port']) is not int or not (r['port']==443 or 1024<=r['port']<=65535) or (u.port or 443)!=r['port']:raise ValueError('Origin and HTTPS port must agree')
    if r['bind'] not in {'127.0.0.1','0.0.0.0'}:raise ValueError('Unsupported bind address')
    return u

def render(r):
    spec=importlib.util.spec_from_file_location('stage1_render',Path(__file__).resolve().parents[1]/'stage1/render.py')
    base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
    u=validate_request(r);d=base.render();s=d['services'];del s['bootstrap-admin']
    s['hermes']['volumes']=[v for v in s['hermes']['volumes'] if 'acceptance-client' not in v]
    s['hermes']['networks']['model-egress']={}
    s['postgresql']['environment']['POSTGRES_USER']='unify_bootstrap'
    s['postgresql']['healthcheck']['test']=['CMD-SHELL','pg_isready -h 127.0.0.1 -U unify_bootstrap -d unify']
    s['migrate']['environment']['DATABASE_URL_FILE']='/run/secrets/database-url'
    s['migrate']['volumes']=[v.replace('core-database-url','migration-database-url') for v in s['migrate']['volumes']]
    core=s['unify-core'];core['environment'].pop('KEYCLOAK_ISSUER',None)
    core['environment'].update(AUTH_MODE='oidc',OIDC_ISSUER=r['origin']+'/identity/realms/alica',OIDC_PUBLIC_ORIGIN=r['origin'],OIDC_CLIENT_ID='dsh-core',OIDC_CLIENT_SECRET_FILE='/run/secrets/oidc-client-secret',OIDC_TRANSPORT_ISSUER='http://keycloak:8080/identity/realms/alica')
    core['volumes'].append('./secrets/oidc-client-secret:/run/secrets/oidc-client-secret:ro')
    for n in ['unify-core','reconcile-frameworks']:s[n]['environment']['MEMORY_V4_SCOPE_PATH']='org:'+r['cell']
    s['memory-v4']['environment']['MEMORYV4_API_SCOPE']='org:'+r['cell']
    k=s['keycloak'];k['environment'].update(KC_HOSTNAME=r['origin']+'/identity',KC_HTTP_RELATIVE_PATH='/identity',KC_HTTP_MANAGEMENT_RELATIVE_PATH='/')
    k['command']=[k['command'][0].replace('--hostname-strict=false','--hostname-strict=true --import-realm')]
    k['volumes'].append('./secrets/realm.json:/opt/keycloak/data/import/alica-realm.json:ro')
    c=s['caddy'];c['networks']['application']['aliases']=[u.hostname]
    c['ports']=[{'target':8443,'published':str(r['port']),'host_ip':r['bind'],'protocol':'tcp'}]
    # Local control-plane liveness; public TLS is checked separately with a trusted CA.
    c['volumes'].append('./secrets/framework-ca.crt:/run/secrets/framework-ca.crt:ro')
    c['healthcheck']['test']=['CMD','wget','--quiet','--output-document=/dev/null','http://127.0.0.1:2019/config/']
    for name,v in s.items():v['labels']={'com.alica.stage2':r['cell'],'com.alica.component':name}
    for v in d['volumes'].values():v['labels']={'com.alica.stage2':r['cell']}
    for v in d['networks'].values():v['labels']={'com.alica.stage2':r['cell']}
    d['networks']['model-egress']={'internal':False,'labels':{'com.alica.stage2':r['cell']}}
    d['name']=r['cell']
    apply_tls(d,r)
    return d

def realm(r,client_secret,owner_password):
    validate_request(r)
    return {'realm':'alica','enabled':True,'sslRequired':'external','registrationAllowed':False,
      'resetPasswordAllowed':False,'bruteForceProtected':True,'failureFactor':5,'permanentLockout':False,
      'accessTokenLifespan':300,'ssoSessionIdleTimeout':900,'ssoSessionMaxLifespan':3600,
      'roles':{'client':{'dsh-core':[{'name':n} for n in ['dsh-owner','dsh-operator','dsh-viewer','dsh-auditor']]}},
      'clients':[{'clientId':'dsh-core','enabled':True,'publicClient':False,'secret':client_secret,
        'standardFlowEnabled':True,'directAccessGrantsEnabled':False,'serviceAccountsEnabled':False,
        'redirectUris':[r['origin']+'/api/v1/auth/oidc/callback'],'webOrigins':[r['origin']],
        'attributes':{'pkce.code.challenge.method':'S256'},
        'protocolMappers':[
          {'name':'dsh-audience','protocol':'openid-connect','protocolMapper':'oidc-audience-mapper','config':{'included.client.audience':'dsh-core','access.token.claim':'true','id.token.claim':'false'}},
          {'name':'dsh-client-roles','protocol':'openid-connect','protocolMapper':'oidc-usermodel-client-role-mapper','config':{'usermodel.clientRoleMapping.clientId':'dsh-core','claim.name':'resource_access.dsh-core.roles','jsonType.label':'String','multivalued':'true','access.token.claim':'true','id.token.claim':'false'}},
        ]}],
      'users':[{'username':r['owner'],'enabled':True,'firstName':'DSH','lastName':'Owner',
        'requiredActions':['UPDATE_PASSWORD'],'credentials':[{'type':'password','value':owner_password,'temporary':True}],
        'clientRoles':{'dsh-core':['dsh-owner']}}]}

def apply_tls(d,r):
    mode=r.get('tls_mode','engineering');c=d['services']['caddy']
    if mode=='proxy':
        c.pop('ports',None)
        d['networks']['public-edge']={'external':True,'name':r['edge_network']}
        c['networks']['public-edge']={'aliases':[r['cell']+'-edge']}
    elif mode=='acme':
        c['ports']=[{'target':8080,'published':'80','host_ip':r['bind'],'protocol':'tcp'},{'target':8443,'published':'443','host_ip':r['bind'],'protocol':'tcp'}]
        d['networks']['acme-egress']={'internal':False,'labels':{'com.alica.stage2':r['cell']}}
        c['networks']['acme-egress']={}

def caddyfile(r):
    u=validate_request(r);mode=r.get('tls_mode','engineering')
    prefix=('http://'+u.hostname+':8080 {\n' if mode=='proxy' else '{\n http_port 8080\n https_port 8443\n}\nhttps://'+u.hostname+' {\n' if mode=='acme' else 'https://'+u.hostname+':8443 {\n tls /run/secrets/edge.crt /run/secrets/edge.key\n')
    config=(prefix+' request_body {\n  max_size 1MB\n }\n'
      ' @private path /identity/admin /identity/admin/* /identity/realms/master /identity/realms/master/*\n respond @private 404\n'
      ' handle /identity/* {\n  reverse_proxy keycloak:8080\n }\n handle {\n  reverse_proxy uniui:3000\n }\n}\n')
    if mode=='proxy':
        for upstream in ['keycloak:8080','uniui:3000']:
            config=config.replace('reverse_proxy '+upstream+'\n','reverse_proxy '+upstream+' {\n   header_up X-Forwarded-Proto https\n  }\n')
    return config
