#!/usr/bin/env python3
"""Discard only stopped failed Stage1 test data; retain root-private failure evidence.
Never use against a successful candidate or a production project.
"""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path('/srv/dsh-stage1-candidate');PROJECT='dsh-stage1'

def reset():
    def run(*args): return subprocess.check_output(args,text=True,timeout=90)
    marker=json.loads((ROOT/'.stage1-owner.json').read_text())
    report=json.loads((ROOT/'exercise-result.json').read_text())
    assert marker['project']==PROJECT and marker['image_lock_sha256']==hashlib.sha256((ROOT/'images.lock.json').read_bytes()).hexdigest(), 'owner mismatch'
    assert report['pass'] is False and report['checks']['final_candidate_stopped'] and report['checks']['existing_workloads_unchanged'], 'not a stopped isolated failed test'
    command=['docker','compose','--project-name',PROJECT,'--project-directory',str(ROOT),'-f',str(ROOT/'compose.json')]
    config=json.loads(run(*command,'config','--format','json'))
    assert config['name']==PROJECT
    for v in config.get('volumes',{}).values():
        assert not v.get('external') and v['name'].startswith(PROJECT+'_')
        present=run('docker','volume','ls','-q','--filter','name=^'+v['name']+'$').strip()
        if present:
            labels=json.loads(run('docker','volume','inspect',v['name']))[0]['Labels']
            assert labels.get('com.docker.compose.project')==PROJECT and labels.get('com.alica.stage1')=='ins_dsh_stage1'
    for n in config['networks'].values(): assert not n.get('external') and n['name'].startswith(PROJECT+'_')
    ids=run('docker','ps','-aq','--filter','label=com.docker.compose.project='+PROJECT).split()
    for c in json.loads(run('docker','inspect',*ids)) if ids else []:
        assert not c['State']['Running'] and c['Config']['Labels'].get('com.alica.stage1')=='ins_dsh_stage1'
    run(*command,'down','--volumes','--timeout','20')
    dest=Path('/srv/dsh-stage1-failed-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    ROOT.rename(dest)
    print(json.dumps({'discarded':'stopped candidate-only test volumes','retained_private_failure_directory':str(dest)}))

if __name__=='__main__':reset()
