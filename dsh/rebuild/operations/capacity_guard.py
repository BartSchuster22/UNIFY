#!/usr/bin/env python3
"""Read-only DSH capacity monitor/admission check. No deletion or lifecycle authority."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

GIB = 1024 ** 3

def violations(s, admission=False):
    errors = []
    disk_min, ram_min = (12 * GIB, 3 * GIB) if admission else (8 * GIB, 1.5 * GIB)
    if s['diskAvailableBytes'] < disk_min:
        errors.append('disk capacity below ' + str(disk_min / GIB) + ' GiB')
    if s['memoryAvailableBytes'] < ram_min:
        errors.append('available RAM below ' + str(ram_min / GIB) + ' GiB')
    if len(s['runningQaProjects']) > (0 if admission else 1):
        errors.append('QA cell budget exceeded: ' + ', '.join(s['runningQaProjects']))
    if s['unreferencedStage1Archives']:
        errors.append('superseded Stage1 image archives accumulated; manual retention review required')
    return errors

def snapshot(root):
    mem = {line.split(':')[0]: int(line.split()[1]) * 1024
           for line in Path('/proc/meminfo').read_text().splitlines()}
    prefix = [] if os.geteuid() == 0 else ['sudo', '-n']
    names = subprocess.check_output(prefix + ['docker', 'ps', '--format',
        '{{.Label "com.docker.compose.project"}}'], text=True, timeout=30).splitlines()
    projects = set(n for n in names if n.startswith('dsh2-stage'))
    vm = subprocess.run(['systemctl', 'show', 'dsh-stage5-qa-vm.service',
                         '--property=ActiveState', '--value'], capture_output=True, text=True, timeout=10)
    if vm.returncode != 0:
        raise RuntimeError('cannot observe QA VM lifecycle')
    if vm.stdout.strip() in ('active', 'activating', 'deactivating'):
        projects.add('vm:dsh-stage5-qa')
    package = root / 'stage1-package'
    old = []
    if package.exists():
        lock = json.loads((package / 'images.lock.json').read_text())
        kept = lock['archive']['filename']
        if not (package / kept).is_file():
            raise RuntimeError('retained Stage1 archive missing')
        old = sorted(p.name for p in package.glob('images-*.tar') if p.name != kept)
    return {'hostname': os.uname().nodename,
        'diskAvailableBytes': shutil.disk_usage(root if root.exists() else Path('/')).free,
        'memoryAvailableBytes': mem['MemAvailable'],
        'swapUsedBytes': mem['SwapTotal'] - mem['SwapFree'],
        'runningQaProjects': sorted(projects),
        'unreferencedStage1Archives': old}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=Path('/srv/alica-dsh-development'))
    p.add_argument('--admission', action='store_true', help='exit nonzero unless another QA cell fits policy')
    p.add_argument('--quiet', action='store_true', help='emit nothing when monitor checks pass')
    args = p.parse_args()
    try:
        data = snapshot(args.root)
        issues = violations(data, args.admission)
        if not args.quiet or issues:
            print(json.dumps({'snapshot': data, 'issues': issues, 'admitted': not issues}))
        return 1 if issues else 0
    except Exception as e:
        print(json.dumps({'error': type(e).__name__, 'admitted': False}))
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
