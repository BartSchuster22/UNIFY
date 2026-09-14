"""Validate retained Step 5 evidence; does not rerun live inference."""
import ast
import csv
import hashlib
import json
from pathlib import Path

root = Path(__file__).parent
proof = root / 'step5-evidence'
def load(name):
    return json.loads((proof / name).read_text())

artifact = load('result.json')
with (proof / 'input.csv').open(newline='') as stream:
    rows = list(csv.DictReader(stream))
expected = sum(int(row['quantity']) * int(row['unit_price_cents']) for row in rows)
assert artifact['total_cents'] == expected
assert artifact['rows'] == [row['item'] for row in rows]
assert set(artifact['codes']) == {'SOUL-STEP5-ORCHID', 'MEMORY-STEP5-CEDAR', 'USER-STEP5-AMBER', 'SKILL-STEP5-COBALT'}
acceptance = load('acceptance.json')
assert hashlib.sha256((proof / 'result.json').read_bytes()).hexdigest() == acceptance['artifactSha256']
primary = load('step5-trace.json')
assert len(primary['requests']) == acceptance['successfulPrimaryRequests']
assert all(r['provider'] == 'openai-codex' and r['requestModel'] == 'gpt-5.6-sol' and r['status'] == 'returned' and 'terminal' not in r['toolNames'] for r in primary['requests'])
assert [t['name'] for t in primary['tools']] == ['skill_view', 'read_file', 'write_file', 'memory', 'read_file']
for name in ['skill_view', 'memory']:
    assert json.loads(next(t['content'] for t in primary['tools'] if t['name'] == name))['success']
assert json.loads(next(t['content'] for t in primary['tools'] if t['name'] == 'write_file'))['verified']
assert primary['systemPromptChecks'][0] == {'instructions': True, 'memory': True, 'userMemory': True, 'enabledSkill': True, 'disabledSkill': False}
discovery = load('step5-discovery-trace.json')
assert primary['sessions'][0]['sessionId'] != discovery['sessions'][0]['sessionId']
skills = json.loads(next(t['content'] for t in discovery['tools'] if t['name'] == 'skills_list'))
assert skills['count'] == 1 and skills['skills'][0]['name'] == 'qa-enabled-proof'
assert json.loads(next(t['content'] for t in discovery['tools'] if t['name'] == 'tool_search'))['matches'] == []
assert 'terminal' not in ast.literal_eval(discovery['toolAttributes']['valid_tool_names'])
fallback = load('step5-fallback-trace.json')
assert [(t['before'], t['after']) for t in fallback['fallbackTransitions']] == [('gpt-5.6-sol', 'gpt-5.6-terra'), ('gpt-5.6-terra', 'gpt-5.6-luna')]
assert all(t['activated'] for t in fallback['fallbackTransitions'])
assert all(r['faultInjection'] == 'local-http-429; no upstream inference attempted' and r['status'] == 'error' for r in fallback['requests'][:-1])
assert fallback['requests'][-1]['model'] == 'gpt-5.6-luna' and fallback['requests'][-1]['status'] == 'returned'
assert fallback['configurationRestored']
browser = load('browser-closure.json')
assert browser['nativeModelMemoryUpdateVisibleInBrowser'] and browser['qaProjectArchived'] and not browser['javascriptErrors']
cleanup = load('cleanup.json')
assert cleanup['qaProfileAndCopiedCredentialsRemoved'] and cleanup['qaWorkspaceRemoved']
closure = load('deployment-closure.json')
assert closure[0]['healthyServices'] == 7 and closure[-1]['installerPlanState'] == 'installed'
for path in (root / 'step5-harness').glob('*.py'):
    ast.parse(path.read_text())
print(json.dumps({'retainedLiveEvidence': 'verified', 'artifactTotalCents': expected, 'primaryRequests': len(primary['requests']), 'fallbackOrder': 'sol -> terra -> luna', 'cleanup': 'verified', 'liveInferenceRerun': False}))
