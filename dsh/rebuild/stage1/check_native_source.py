#!/usr/bin/env python3
"""Compare packaged native Python code against a pinned Git tree without starting it."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import uuid

REV = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4'
PREFIXES = ['hermes_cli', 'cron', 'gateway', 'plugins/kanban']


def check(image, repository):
    def run(args): return subprocess.check_output(args)
    name = 'dsh-stage1-source-' + uuid.uuid4().hex[:10]
    expected = {}
    archive = run(['git', '-C', repository, 'archive', REV, *PREFIXES])
    with tarfile.open(fileobj=io.BytesIO(archive)) as t:
        for m in t.getmembers():
            if m.isfile() and m.name.endswith('.py'):
                f = t.extractfile(m)
                assert f is not None
                expected[m.name] = hashlib.sha256(f.read()).hexdigest()
    got = {}
    run(['docker', 'create', '--name', name, '--network', 'none', '--entrypoint', '/bin/true', image])
    try:
        for prefix in PREFIXES:
            with tarfile.open(fileobj=io.BytesIO(run(['docker', 'cp', name + ':/opt/hermes/' + prefix, '-']))) as t:
                parent = str(Path(prefix).parent)
                for m in t.getmembers():
                    key = m.name if parent == '.' else parent + '/' + m.name
                    if m.isfile() and key.endswith('.py'):
                        f = t.extractfile(m)
                        assert f is not None
                        got[key] = hashlib.sha256(f.read()).hexdigest()
    finally:
        subprocess.run(['docker', 'rm', '-v', name], check=True, stdout=subprocess.DEVNULL)
    # Reproduce the declared build overlay against pristine pinned source, then
    # require exact bytes, not a blanket exception for changed files.
    import tempfile
    import sys
    overlays = ['hermes_cli/web_server.py', 'hermes_cli/web_models.py']
    patch_path = Path(__file__).resolve().parents[3] / 'deploy/hermes-runtime/patch-provider-validation.py'
    with tempfile.TemporaryDirectory(prefix='dsh-stage1-source-') as tmp:
        base = Path(tmp)
        (base / 'hermes_cli').mkdir()
        for key in overlays:
            (base / key).write_bytes(run(['git', '-C', repository, 'show', REV + ':' + key]))
        patch_source = patch_path.read_text()
        for key in overlays:
            patch_source = patch_source.replace("Path('/opt/hermes/" + key + "')", 'Path(' + repr(str(base / key)) + ')')
        subprocess.run([sys.executable, '-c', patch_source], check=True, capture_output=True)
        for key in overlays:
            expected[key] = hashlib.sha256((base / key).read_bytes()).hexdigest()
    missing = sorted(set(expected) - set(got))
    changed = sorted(k for k in expected.keys() & got.keys() if expected[k] != got[k])
    return {'source_commit': REV, 'image': image, 'started': False,
            'tracked_python_files': len(expected), 'matching': sum(expected[k] == got.get(k) for k in expected),
            'missing': missing, 'changed': changed, 'declared_overlays': overlays,
            'overlay_source': 'deploy/hermes-runtime/patch-provider-validation.py',
            'pass': not missing and not changed,
            'scope': 'Native CLI, gateway, cron and Kanban Python source consistency, not complete third-party supply-chain audit'}


if __name__ == '__main__':
    import sys
    result = check(sys.argv[1], sys.argv[2])
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['pass'] else 1)
