#!/usr/bin/env python3
"""Silent when healthy; cron delivers stdout warnings to the VPS owner."""
import shutil
import subprocess
import time


def evaluate(free, total, props, last_exit, now):
    issues = []
    if free < 12*1024**3 or 1-free/total >= .85:
        issues.append(f'Disk headroom low: {free/1024**3:.1f} GiB available; required floor for starting backups is 12 GiB.')
    if props.get('Result') not in ('success', None) or props.get('ExecMainStatus', '0') != '0':
        issues.append('Hermes backup failed: '+props.get('Result', 'unknown')+'. Check journalctl -u herman-backup.service.')
    if props.get('ActiveState') != 'activating' and (not last_exit or now-last_exit > 30*3600):
        issues.append('No successful recent Hermes backup run within 30 hours.')
    return issues


def main():
    result = subprocess.run(['systemctl','show','herman-backup.service','-p','Result','-p','ExecMainStatus','-p','ExecMainExitTimestamp','-p','ActiveState'], capture_output=True, text=True, check=True)
    props = dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    stamp = props.get('ExecMainExitTimestamp','')
    last = 0
    if stamp and stamp != 'n/a':
        last = float(subprocess.check_output(['date','-d',stamp,'+%s'], text=True))
    disk = shutil.disk_usage('/')
    issues = evaluate(disk.free,disk.total,props,last,time.time())
    if issues: print('VPS storage / backup alert\n'+'\n'.join('- '+x for x in issues))

def check_dsh_capacity():
    try:
        result = subprocess.run(['python3', '/home/herman/capacity-cleanup/check_hosts.py'],
                                capture_output=True, text=True, timeout=140)
        if result.stdout.strip():
            print(result.stdout.strip())
        if result.returncode:
            print('DSH capacity check failed; inspect installed read-only check.')
    except (OSError, subprocess.TimeoutExpired) as exc:
        print('DSH capacity check unavailable: '+type(exc).__name__)


if __name__ == '__main__':
    try:
        main()
    finally:
        check_dsh_capacity()
