#!/usr/bin/env python3
"""Read-only two-host capacity check. Silent when healthy; never deletes/stops anything."""
import subprocess
from pathlib import Path
commands = [
    ['python3', str(Path(__file__).with_name('capacity_guard.py')), '--quiet'],
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-i',
     '/home/herman/.ssh/alica_v1_deploy_ed25519', 'deploy@167.233.135.142',
     'python3 /srv/alica-dsh-development/capacity_guard.py --quiet'],
]
for name, command in zip(['ElioHermes1', 'ALICA-v1'], commands):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)
        if result.returncode or result.stdout.strip():
            print(name + ' capacity review: ' + (result.stdout.strip() or 'check failed; inspect host access'))
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(name + ' capacity check unavailable: ' + type(exc).__name__)
