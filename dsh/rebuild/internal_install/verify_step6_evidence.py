"""Check the retained live evidence; preserve the failed Step 6 verdict."""
import csv
import hashlib
import json
from pathlib import Path

root = Path(__file__).parent / 'step6-evidence'
def load(name):
    return json.loads((root / name).read_text())

native = load('native-runtime.json')
success = native['tasks']['t_aba997f6']
failure = native['tasks']['t_bacfcc56']
assert success['task']['status'] == 'done'
assert len(success['runs']) == 1 and success['runs'][0]['outcome'] == 'completed'
assert success['runs'][0]['metadata']['artifacts']
assert failure['task']['status'] == 'blocked' and not native['missingInputExists']
assert len(native['sessions']) == 2
assert all(s['source'] == 'kanban' and s['model'] == 'gpt-5.6-sol' and s['billing_provider'] == 'openai-codex' and s['api_call_count'] > 0 for s in native['sessions'])
with (root / 'input.csv').open(newline='') as f:
    rows = list(csv.DictReader(f))
result = load('result.json')
assert result['total_cents'] == sum(int(r['quantity']) * int(r['unit_price_cents']) for r in rows)
assert result['rows'] == [r['item'] for r in rows]
for key, value in {'instruction_code': 'SOUL-STEP6-ORCHID', 'memory_code': 'MEMORY-STEP6-CEDAR', 'user_memory_code': 'USER-STEP6-AMBER', 'skill_code': 'SKILL-STEP6-COBALT'}.items():
    assert result[key] == value
assert hashlib.sha256((root / 'result.json').read_bytes()).hexdigest() == '5c7e6e70445ed8dea33e580db54b973c73aa22ebb2afb7445e92d9bb039f10f4'
board = load('step6-board-observation.json')
assert board['taskVisible'] and not board['javascriptErrors']
observed = load('step6-failure-browser.json')
assert {'ready', 'running', 'blocked'} <= {x['status'] for x in observed['observations']}
# These assertions preserve the observed gaps rather than converting them into passes.
assert success['task']['workspace_kind'] == 'scratch' and success['task']['project_id'] is None
assert not board['resultSummaryVisible'] and board['cancelControlCount'] == 0
cleanup = load('cleanup.json')
assert cleanup['activeQaWorkers'] == []
assert cleanup['qaTasksAndBoardArchived'] and cleanup['qaProfileAndCopiedCredentialsRemoved'] and cleanup['qaWorkspaceRemoved']
closure = load('deployment-closure.json')
assert closure[0]['healthyServices'] == 7 and closure[-1]['installerPlanState'] == 'installed'
print(json.dumps({'evidence': 'verified', 'qualified': False, 'browserDispatchedModelBackedTask': True, 'artifactTotalCents': result['total_cents'], 'controlledFailure': 'blocked-not-done', 'cancellation': 'unavailable-not-tested', 'cleanup': 'verified', 'remaining': ['workspace propagation', 'execution/result UI', 'refresh reliability', 'safe cancellation']}))
