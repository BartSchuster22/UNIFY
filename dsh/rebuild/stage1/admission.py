#!/usr/bin/env python3
"""Measured admission for a bounded, stopped-after-test engineering candidate only."""
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess

GIB = 1024**3

def admission(host, compose, lock):
    from render import validate
    services = compose['services']
    steady = [v for v in services.values() if not v.get('profiles')]
    jobs = [v for v in services.values() if v.get('profiles')]
    memory_cap = sum(v['mem_limit'] for v in steady) + max(v['mem_limit'] for v in jobs)
    cpu_cap = sum(v['cpus'] for v in steady) + max(v['cpus'] for v in jobs)
    # Conservative staging/unpack allowance; not an application minimum.
    image_bytes = sum(v['size_bytes'] for v in lock['images'].values())
    disk_required = 4 * image_bytes + 2 * GIB + 8 * GIB
    checks = {
        'ubuntu_26_04_amd64': host.get('os_id') == 'ubuntu' and host.get('os_version') == '26.04' and host.get('architecture') == 'x86_64',
        'docker_29_observed': bool(re.fullmatch(r'29\.\d+\.\d+(?:[-+].*)?', host.get('docker_version', ''))),
        'compose_v2_observed': bool(re.fullmatch(r'v?2\.\d+\.\d+(?:[-+].*)?', host.get('compose_version', ''))),
        'cgroup_v2': host.get('cgroup_version') == '2',
        'cpu_cap_plus_host_reserve': host.get('cpus', 0) >= cpu_cap + 1,
        'memory_cap_plus_1GiB_reserve': host.get('available_memory_bytes', 0) >= memory_cap + GIB,
        'disk_images_staging_data_plus_8GiB_reserve': host.get('free_disk_bytes', 0) >= disk_required,
        'loopback_port_free': host.get('port_available') is True,
        'candidate_namespace_unused': host.get('namespace_free') is True,
        'fresh_candidate_root': host.get('root_free') is True,
        'isolation_manifest': not validate(compose),
        'native_source_verified': lock.get('native_source_check', {}).get('pass') is True,
        'image_lock_complete': set(lock.get('images', {})) == {'hermes','unify-core','uniui','memory-v4','postgresql','keycloak','caddy'} and all(re.fullmatch(r'sha256:[0-9a-f]{64}', v.get('id', '')) and v.get('size_bytes', 0) > 0 for v in lock.get('images', {}).values()),
        'no_observation_errors': not host.get('errors'),
    }
    return {'schema': 'dsh-stage1-admission/v1', 'scope': 'bounded engineering qualification, no production or workload-capacity claim',
            'pass': all(checks.values()), 'checks': checks, 'candidate_memory_cap_bytes_including_one_job': memory_cap,
            'candidate_cpu_cap_including_one_job': cpu_cap, 'host_memory_reserve_bytes': GIB,
            'image_size_sum_bytes': image_bytes, 'required_free_disk_bytes': disk_required,
            'restrictions': ['one job at a time', 'no provider or channel credentials', 'internal-only networks',
                             'loopback-only ingress', 'candidate-only stop on low resources', 'stop after exercise',
                             'no production mounts, credentials, routes, schedules or Docker socket']}


def observe(project='dsh-stage1', root='/srv/dsh-stage1-candidate'):
    def run(*args): return subprocess.check_output(args, text=True, timeout=20).strip()
    osdata = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    mem = {l.split(':')[0]: int(l.split()[1])*1024 for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith(('MemTotal:', 'MemAvailable:'))}
    with socket.socket() as s:
        try: s.bind(('127.0.0.1',18443)); free = True
        except OSError: free = False
    resources = [run('docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project='+project),
                 run('docker', 'network', 'ls', '-q', '--filter', 'label=com.docker.compose.project='+project),
                 run('docker', 'volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project='+project)]
    return {'os_id':osdata['ID'].strip('"'), 'os_version':osdata['VERSION_ID'].strip('"'),
            'architecture':os.uname().machine, 'cpus':os.cpu_count(), 'memory_bytes':mem['MemTotal'],
            'available_memory_bytes':mem['MemAvailable'], 'free_disk_bytes':shutil.disk_usage('/srv').free,
            'docker_version':run('docker','version','--format','{{.Server.Version}}'),
            'compose_version':run('docker','compose','version','--short'),
            'cgroup_version':run('docker','info','--format','{{.CgroupVersion}}'),
            'port_available':free, 'namespace_free':not any(resources), 'root_free':not Path(root).exists(), 'errors':[]}

if __name__ == '__main__':
    import sys
    package=Path(sys.argv[1])
    host=observe()
    result=admission(host,json.loads((package/'compose.template.json').read_text()),json.loads((package/'images.lock.json').read_text()))
    print(json.dumps({'host':host,'admission':result},indent=2))
    raise SystemExit(0 if result['pass'] else 3)
