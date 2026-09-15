#!/usr/bin/env python3
"""Offline verification of bounded Step 7B scheduling acceptance evidence."""
import hashlib
import json
from datetime import datetime
from pathlib import Path


def verify(root):
    def load(name):
        return json.loads((root / ('step7b-' + name + '.json')).read_text())
    for line in (root / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        p = root / name
        assert p.resolve().is_relative_to(root.resolve())
        assert hashlib.sha256(p.read_bytes()).hexdigest() == digest, name
    assert load('prepare')['initialJobs'] == []
    before, after = load('before'), load('after-restart')
    assert before['job'] == after['job']
    assert not before['job']['enabled'] and before['job']['no_agent']
    assert not before['attempts'] and not after['attempts']
    for name in ['lifecycle', 'active-lifecycle']:
        cycle = load(name)
        assert cycle['events'][0]['result']['data_retained']
        assert cycle['events'][1]['allSevenStopped']
        assert cycle['events'][2]['result']['runtime_health'] == 'healthy'
        for n, identity in cycle['after']['identities'].items():
            old = cycle['before']['identities'][n]
            assert old['started'] != identity['started'] and old['image'] == identity['image']
        for key in ['ownerFilesUnchanged', 'preexistingBoardsAndRunsUnchanged', 'unrelatedContainersUnchanged', 'brokerIdentityVerified', 'maintenanceCleared', 'brokerAndObserverActive']:
            assert cycle['after'][key], key
    armed, restarted, done, final = [load(n) for n in ['armed', 'active-after-restart', 'completed', 'final']]
    assert armed['job']['enabled'] and not armed['attempts']
    for key in ['id', 'name', 'schedule', 'script', 'no_agent', 'workdir', 'deliver']:
        assert armed['job'].get(key) == restarted['job'].get(key) == done['job'].get(key), key
    assert done['job']['state'] == 'completed' and done['job']['last_status'] == 'ok'
    assert not done['job']['enabled'] and done['job']['next_run_at'] is None
    assert done['job']['repeat']['times'] == done['job']['repeat']['completed'] == 1
    assert len(done['attempts']) == 1 and final['attempts'] == done['attempts']
    assert final['job'] == done['job']
    started = load('active-lifecycle')['after']['identities']['/dsh2-internal-dev3-hermes-1']['started']
    assert datetime.fromisoformat(done['attempts'][0]['utc']) >= datetime.fromisoformat(__import__('re').sub(r'(\.\d{6})\d+', r'\1', started.replace('Z', '+00:00')))
    assert any('STEP7B-SCHEDULED-INVOCATION' in text for text in final['savedOutputs'].values())
    for action in ['create', 'pause', 'resume', 'remove']:
        assert load(action)['response']['operation']['state'] == 'verified'
    cleanup = load('cleanup')
    assert cleanup['jobRemoved'] and cleanup['workspaceRemoved'] and cleanup['remainingJobs'] == []
    protection = load('protection')
    for key in ['ownerFilesUnchanged', 'preexistingBoardsAndRunsUnchanged', 'unrelatedContainersUnchanged', 'brokerIdentityVerified', 'maintenanceCleared', 'brokerAndObserverActive']:
        assert protection[key], key
    assert protection['healthyServices'] == 7
    assert cleanup['scriptRemoved']
    fixed = load('active-filter-fixed')
    assert fixed['allCount'] == 1 and fixed['activeCount'] == fixed['overviewActiveCount'] == 0
    assert fixed['completedExcludedFromActive'] and fixed['completedRetainedInAll'] and fixed['survivesReload']
    update = load('ui-update')
    assert update['state'] == 'verified' and set(update['images']) == {'uniui'}
    assert protection['identities']['/dsh2-internal-dev3-uniui-1']['image'] == update['images']['uniui']
    for name, identity in load('active-lifecycle')['after']['identities'].items():
        if name != '/dsh2-internal-dev3-uniui-1':
            assert protection['identities'][name] == identity
    acceptance = load('acceptance')
    assert acceptance['pausedRestartContinuity'] and acceptance['activePendingRestartContinuity']
    assert acceptance['noDuplicateAfter70Seconds'] and acceptance['freshOwnerLogin']
    return {'evidence': 'PASS', 'lifecycleCycles': 2, 'scheduledInvocations': 1,
            'nativeOutcome': 'completed/ok', 'delivery': 'local',
            'scope': 'script-only one-shot; paused and active-pending restart continuity'}


if __name__ == '__main__':
    print(json.dumps(verify(Path(__file__).with_name('step7b-evidence')), indent=2))
