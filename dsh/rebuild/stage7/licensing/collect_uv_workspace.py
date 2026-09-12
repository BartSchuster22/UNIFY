"""Replay exact pinned uv workspace licence inheritance; never binary/legal clearance."""
import argparse
import concurrent.futures
import hashlib
import json
import re
import urllib.request
from pathlib import Path
try:
    import tomllib
except ImportError:
    from pip._vendor import tomli as tomllib

BASE = Path(__file__).resolve().parent
INPUT = BASE/'registry-review-v2/review-queue.json'
PIN = '65950801cc3c609b65be34938bb407ab6e30a9fe'
ROOT = 'https://raw.githubusercontent.com/astral-sh/uv/' + PIN + '/'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def paths_for(queue):
    names = {r['name'] for r in queue if eligible(r)}
    if any(not re.fullmatch('uv(?:-[a-z0-9-]+)?', n) for n in names):
        raise ValueError('Unsafe crate name')
    extra = {'crates/'+n+'/'+f for n in names & {'uv-pep440', 'uv-pep508'} for f in ['License-Apache', 'License-BSD']}
    return sorted({'Cargo.toml', 'LICENSE-APACHE', 'LICENSE-MIT'} | {'crates/'+n+'/Cargo.toml' for n in names} | extra)


def eligible(row):
    return row['reviewStatus'] == 'licence-metadata-unresolved' and row['type'] == 'rust-crate' and (row['name'] == 'uv' or row['name'].startswith('uv-'))


def derive(queue, read):
    workspace = tomllib.loads(read('Cargo.toml').decode())['workspace']
    if 'crates/*' not in workspace['members']:
        raise ValueError('Unexpected workspace membership')
    licence = workspace['package']['license']
    if not isinstance(licence, str) or not licence:
        raise ValueError('Missing workspace licence')
    for p in ['LICENSE-APACHE', 'LICENSE-MIT']:
        if not read(p).strip():
            raise ValueError('Empty licence text')
    result = json.loads(json.dumps(queue))
    added = 0
    for row in result:
        if not eligible(row):
            continue
        path = 'crates/' + row['name']
        if path in workspace.get('exclude', []):
            raise ValueError('Excluded workspace member')
        package = tomllib.loads(read(path+'/Cargo.toml').decode())['package']
        if package['name'] != row['name'] or package['version'] != row['version']:
            raise ValueError('Crate identity mismatch: '+row['name'])
        declared = package.get('license')
        inherited = declared == {'workspace': True}
        if inherited:
            actual = licence
        elif isinstance(declared, str) and declared:
            actual = declared
            for f in package.get('include', []):
                if f.lower().startswith('license') and not read(path+'/'+f).strip():
                    raise ValueError('Missing package-specific licence text')
        else:
            raise ValueError('Missing package licence: '+row['name'])
        row['workspaceEvidence'] = {'repository': 'https://github.com/astral-sh/uv', 'commit': PIN,
                                   'manifest': path+'/Cargo.toml', 'declaration': actual,
                                   'inheritedFrom': 'Cargo.toml' if inherited else None, 'binaryIdentityProven': False,
                                   'legalDispositionApproved': False}
        row['reviewStatus'] = 'upstream-workspace-declaration-observed-obligations-unreviewed'
        added += 1
    return result, {'addedMetadataOccurrences': added, 'remainingMissingMetadata': sum(r['reviewStatus'] == 'licence-metadata-unresolved' for r in result), 'stage74Accepted': False, 'legalReviewComplete': False}


def verify(out):
    report = json.loads((out/'report.json').read_text())
    raw = INPUT.read_bytes()
    queue = json.loads(raw)
    if report['commit'] != PIN or report['inputSha256'] != sha(raw):
        raise ValueError('Changed provenance/input')
    sources = report['sources']
    if sorted(sources) != paths_for(queue):
        raise ValueError('Changed source coverage')
    for path, record in sources.items():
        h = record['sha256']
        if not re.fullmatch('[0-9a-f]{64}', h) or record['url'] != ROOT+path:
            raise ValueError('Changed source identity')
        data = (out/'objects'/h).read_bytes()
        if sha(data) != h or len(data) != record['bytes']:
            raise ValueError('Source hash/size mismatch')
    def read(path):
        return (out/'objects'/sources[path]['sha256']).read_bytes()
    derived, summary = derive(queue, read)
    if json.loads((out/'review-queue.json').read_text()) != derived:
        raise ValueError('Changed derived queue')
    if report['summary'] != summary:
        raise ValueError('Changed summary/approval')
    if {p.name for p in (out/'objects').iterdir()} != {v['sha256'] for v in sources.values()}:
        raise ValueError('Unexpected objects')
    return dict(sourcesRehashed=len(sources), **summary)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Unexpected source redirect')


def fetch(path):
    with urllib.request.build_opener(NoRedirect()).open(ROOT+path, timeout=30) as f:
        data = f.read(1024*1024+1)
    if len(data) > 1024*1024:
        raise ValueError('Source too large')
    return path, data


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--verify', action='store_true')
    a = p.parse_args()
    if a.verify:
        print(json.dumps(verify(a.output), indent=2))
        return
    raw = INPUT.read_bytes()
    queue = json.loads(raw)
    paths = paths_for(queue)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        material = dict(pool.map(fetch, paths))
    derived, summary = derive(queue, material.__getitem__)
    a.output.mkdir(exist_ok=False)
    (a.output/'objects').mkdir()
    sources = {}
    for path, data in material.items():
        h = sha(data)
        (a.output/'objects'/h).write_bytes(data)
        sources[path] = {'url': ROOT+path, 'sha256': h, 'bytes': len(data)}
    report = {'commit': PIN, 'tagObserved': '0.11.6', 'inputSha256': sha(raw), 'sources': sources, 'summary': summary,
              'limitations': ['Git tag resolved with git ls-remote; retained bytes pinned to commit.', 'Matching package name/version and workspace inheritance are upstream evidence, not proof of shipped binary identity.', 'Licence texts retained; corresponding source/build/relink completeness and legal obligations remain unapproved.']}
    (a.output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    (a.output/'review-queue.json').write_text(json.dumps(derived, indent=2)+'\n')
    print(json.dumps(verify(a.output), indent=2))


if __name__ == '__main__':
    main()
