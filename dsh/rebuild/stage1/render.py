#!/usr/bin/env python3
"""Render an isolated Stage 1 engineering baseline; NOT a production installer."""
import copy
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
CAPS_MIB = {'postgresql': 256, 'keycloak': 768, 'memory-v4': 256, 'hermes': 1024,
            'unify-core': 384, 'uniui': 128, 'caddy': 64, 'migrate': 256,
            'bootstrap-admin': 256, 'reconcile-frameworks': 256}
CPUS = {'postgresql': .25, 'keycloak': .75, 'memory-v4': .2, 'hermes': .75,
        'unify-core': .25, 'uniui': .1, 'caddy': .05}


def render():
    import yaml
    d = yaml.safe_load((ROOT / 'dsh/alicactl/internal/install/assets/compose.yaml').read_text())
    s = d['services']
    for name in ['herman', 'ainba-anchor', 'doghouse-node']:
        del s[name]
    s['hermes'] = s.pop('alica')
    h = s['hermes']
    e = h['environment']
    e.update(HERMES_FRAMEWORK_ID='hermes-alica', HERMES_DISPLAY_NAME='DSH', HERMES_BASE_PROFILE_DISPLAY_NAME='DSH', HERMES_INSTANCE_ID='${ALICA_CELL_ID}-hermes', HERMES_ADAPTER_TLS_SERVER_NAME='hermes-adapter')
    h['networks'] = {'database': {}, 'control': {'aliases': ['hermes-adapter']}}
    h['volumes'].append('./acceptance-client.mjs:/run/acceptance-client.mjs:ro')
    # No provider/channel credentials or egress attached during Stage 1.
    core = s['unify-core']
    for k in ['HERMAN_HERMES_RUNTIME_IMAGE', 'HERMAN_FRAMEWORK_TOKEN_FILE', 'ALICA_HERMES_RUNTIME_IMAGE', 'ALICA_FRAMEWORK_TOKEN_FILE']:
        core['environment'].pop(k, None)
    core['environment'].update(FRAMEWORK_AUTH_ENV_NAMES='DSH_FRAMEWORK_TOKEN', DSH_FRAMEWORK_TOKEN_FILE='/run/secrets/alica-token', FRAMEWORK_REGISTRATION_FILE='/app/frameworks.json', HERMES_UPDATE_DISCOVERY_INTERVAL_MS='0')
    core['volumes'] = [v for v in core['volumes'] if 'herman' not in v]
    core['volumes'].append('./frameworks.json:/app/frameworks.json:ro')
    core['depends_on'].pop('alica'); core['depends_on'].pop('herman')
    core['depends_on']['hermes'] = {'condition': 'service_healthy'}
    core['networks'] = ['application', 'database', 'memory', 'control']
    m = s['memory-v4']
    m['environment'].pop('MEMORYV4_BACKUP_DIR', None)
    m['environment']['MEMORYV4_API_SCOPE'] = 'org:dsh-stage1'
    core['environment']['MEMORY_V4_SCOPE_PATH'] = 'org:dsh-stage1'
    m['volumes'] = [v for v in m['volumes'] if 'memory-backups' not in v]
    m['networks'] = ['memory']
    s['keycloak']['environment'].update(KC_CACHE='local', JAVA_OPTS_KC_HEAP='-Xms64m -Xmx256m -XX:MaxMetaspaceSize=160m')
    job = copy.deepcopy(core)
    job.update(command=['dist/cli/reconcile-frameworks.js'], profiles=['jobs'], depends_on={'postgresql': {'condition': 'service_healthy'}})
    job.pop('healthcheck', None)
    s['reconcile-frameworks'] = job
    c = s['caddy']
    c['networks'] = {'application': {'aliases': ['stage1.dsh.invalid']}}
    c['volumes'] += ['./secrets/edge.crt:/run/secrets/edge.crt:ro', './secrets/edge.key:/run/secrets/edge.key:ro']
    c['ports'] = [{'target': 8443, 'published': '18443', 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
    for name, service in s.items():
        service.pop('labels', None)
        service['labels'] = {'com.alica.stage1': '${ALICA_CELL_ID}', 'com.alica.component': name}
        service['restart'] = 'no'
        service['mem_limit'] = CAPS_MIB[name] * 1024**2
        service['memswap_limit'] = service['mem_limit']
        service['cpus'] = CPUS.get(name, .5)
        service['pids_limit'] = 192 if name == 'hermes' else 128
        service['logging'] = {'driver': 'json-file', 'options': {'max-size': '5m', 'max-file': '2'}}
        service.pop('container_name', None)
    # Explicit, fresh named data volumes. No external resources allowed.
    used = {v.split(':')[0] for service in s.values() for v in service.get('volumes', []) if not v.startswith('./')}
    d['volumes'] = {name: {'labels': {'com.alica.stage1': '${ALICA_CELL_ID}'}} for name in sorted(used)}
    d['networks'] = {name: {'internal': True, 'labels': {'com.alica.stage1': '${ALICA_CELL_ID}'}} for name in ['application', 'database', 'memory', 'control']}
    return d


def validate(d):
    s = d['services']; errors = []
    if set(s) != set(CAPS_MIB): errors.append('service-set')
    for name, service in s.items():
        if service.get('privileged') or service.get('network_mode') or service.get('pid') or service.get('ipc'): errors.append('host-sharing:' + name)
        if not service.get('read_only') or 'ALL' not in service.get('cap_drop', []) or 'no-new-privileges:true' not in service.get('security_opt', []): errors.append('hardening:' + name)
        if set(service.get('cap_add', [])) - {'CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE', 'FOWNER'}: errors.append('capability:' + name)
        if service.get('mem_limit') != CAPS_MIB.get(name, 0) * 1024**2 or service.get('memswap_limit') != service.get('mem_limit'): errors.append('memory:' + name)
        if service.get('restart') != 'no': errors.append('restart:' + name)
        for port in service.get('ports', []):
            if name != 'caddy' or port.get('host_ip') != '127.0.0.1' or str(port.get('published')) != '18443': errors.append('public-port:' + name)
        for v in service.get('volumes', []):
            src = v.split(':')[0]
            if src not in d['volumes'] and not re.fullmatch(r'\./(?:secrets/[A-Za-z0-9_.-]+|frameworks\.json|acceptance-client\.mjs|postgres-init\.sql|Caddyfile)', src): errors.append('mount:' + name)
    if any(not v.get('internal') or v.get('external') for v in d['networks'].values()): errors.append('network')
    if any(v.get('external') or v.get('name') for v in d['volumes'].values()): errors.append('volume')
    if s['memory-v4']['networks'] != ['memory'] or any('backup' in v for v in s['memory-v4']['volumes']): errors.append('memory-boundary')
    members = {n for n, v in s.items() if 'memory' in v.get('networks', [])}
    if members != {'memory-v4', 'unify-core', 'reconcile-frameworks'}: errors.append('memory-members')
    if 'herman' in json.dumps(d): errors.append('second-runtime')
    return errors


if __name__ == '__main__':
    d = render()
    errors = validate(d)
    if errors: raise SystemExit(str(errors))
    print(json.dumps(d, indent=2))
