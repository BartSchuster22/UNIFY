#!/usr/bin/env python3
"""Validate retained Step 7A evidence; does not rerun lifecycle or inference."""
import csv
import hashlib
import json
from pathlib import Path


def verify(root: Path) -> dict:
    def load(name):
        return json.loads((root / name).read_text())

    for line in (root / 'SHA256SUMS').read_text().splitlines():
        expected, name = line.split('  ', 1)
        path = root / name
        assert path.resolve().is_relative_to(root.resolve())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, name
    before = load('step7a-continuity-before.json')
    after = load('step7a-continuity-after.json')
    for key in ['tasks', 'sessions', 'profileHashes', 'workspaceHashes', 'artifactSha256']:
        assert before[key] == after[key], key
    assert len(before['tasks']) == 2
    assert {t['runs'][0]['outcome'] for t in before['tasks'].values()} == {'completed', 'cancelled'}
    for label in ['continuity', 'interruption']:
        lifecycle = load('step7a-' + label + '-lifecycle.json')
        assert lifecycle['events'][0]['action'] == 'stop'
        assert lifecycle['events'][0]['result']['data_retained']
        assert lifecycle['events'][1]['allSevenStopped']
        assert lifecycle['events'][2]['action'] == 'start'
        assert lifecycle['events'][2]['result']['runtime_health'] == 'healthy'
        post = lifecycle['after']
        assert post['healthyServices'] == 7 and post['brokerIdentityVerified']
        assert post['ownerFilesUnchanged'] and post['preexistingBoardsAndRunsUnchanged']
        assert post['unrelatedContainersUnchanged'] and post['installerState'] == 'installed'
        for name, identity in post['identities'].items():
            old = lifecycle['before']['identities'][name]
            assert old['started'] != identity['started']
            assert old['image'] == identity['image']
        browser = load('step7a-' + label + '-browser.json')
        for key in ['ownerAuthenticatedAfterRestart', 'workspaceAndTeamRetained', 'modelMemoryToolsSkillsRetained', 'taskTitlesAndRunFeedbackVisible']:
            assert browser[key], key
    interrupted = load('step7a-interruption-before.json')
    final = load('step7a-interruption-final.json')
    created_id = load('step7a-interruption-verified-create.json')['created']['id']
    target = interrupted['tasks'][created_id]
    assert target['task']['status'] == 'running' and target['task']['max_retries'] == 1
    tid = target['task']['id']
    result = final['tasks'][tid]
    assert len(result['runs']) == 1 and result['task']['status'] == 'blocked'
    assert result['task']['worker_pid'] is None and result['task']['current_run_id'] is None
    assert result['runs'][0]['outcome'] not in [None, 'completed', 'done', 'cancelled']
    for other, t in interrupted['tasks'].items():
        if other != tid:
            assert final['tasks'][other] == t
    assert interrupted['profileHashes'] == final['profileHashes']
    for name, digest in interrupted['workspaceHashes'].items():
        assert final['workspaceHashes'][name] == digest
    proof = load('step7a-interruption-proof.json')
    assert proof['before']['started'] and not proof['before']['finished']
    assert len(proof['before']['livePids']) >= 2
    for phase in ['after', 'final']:
        assert not proof[phase]['livePids'] and not proof[phase]['finished']
        assert proof[phase]['sideEffectAttempts'] == 1
    assert proof['noRedispatchAfter70Seconds'] and proof['noFalseCompletion']
    with (root / 'input.csv').open() as stream:
        total = sum(int(row['quantity']) * int(row['unit_price_cents']) for row in csv.DictReader(stream))
    artifact = (root / 'result.json').read_bytes()
    assert json.loads(artifact)['total_cents'] == total
    assert hashlib.sha256(artifact).hexdigest() == final['artifactSha256']
    assert hashlib.sha256((root / 'input.csv').read_bytes()).hexdigest() == final['workspaceHashes']['input.csv']
    cleanup = load('step7a-final-cleanup.json')
    for key in ['oneRunPerTask', 'boardRecoverablyArchived', 'disposableProfileAndCredentialsRemoved', 'disposableWorkspaceRemoved', 'noLiveDisposableWorker']:
        assert cleanup[key], key
    closure = load('step7a-final-browser-cleanup.json')
    assert [p['id'] for p in closure['profiles']] == ['default']
    assert closure['ownerSessionWorksWithoutDisposableAgent'] and closure['workViewAndRefreshHealthyAfterCleanup']
    protection = load('step7a-final-protection.json')
    for key in ['ownerFilesUnchanged', 'preexistingBoardsAndRunsUnchanged', 'unrelatedContainersUnchanged', 'brokerIdentityVerified']:
        assert protection[key], key
    assert protection['healthyServices'] == 7
    return {'evidence': 'PASS', 'lifecycleCycles': 2, 'interruptedTaskRuns': 1,
            'sideEffectAttempts': 1, 'artifactTotalCents': total,
            'scope': 'development cell restart; explicit per-task no-retry policy'}


if __name__ == '__main__':
    print(json.dumps(verify(Path(__file__).with_name('step7a-evidence')), indent=2))
