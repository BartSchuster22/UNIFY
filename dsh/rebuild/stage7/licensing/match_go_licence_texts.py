"""Conservative exact normalized MIT/Apache text matching, not legal disposition."""
import argparse
import hashlib
import json
import re
import urllib.request
import zipfile
from pathlib import Path
import collect_go_notices as go
import collect_uv_workspace as uv

BASE = Path(__file__).resolve().parent
INPUT = BASE/'uv-workspace-review/review-queue.json'
TEMPLATES = {n: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/'+n+'.txt' for n in ['MIT', 'Apache-2.0']}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def norm(text):
    return ' '.join(text.lower().split())


def match(text, templates):
    # Entire Apache text must match, not just its heading or selected phrases.
    if norm(text) == norm(templates['Apache-2.0']):
        return 'Apache-2.0'
    marker = 'Permission is hereby granted'
    if marker not in text or marker not in templates['MIT']:
        return None
    header, body = text.split(marker, 1)
    # Only customary title/copyright lines may precede the exact MIT body.
    for line in header.splitlines():
        line = line.strip()
        if line and not (re.fullmatch(r'(?:The )?MIT License(?: \(MIT\)| \(Expat\))?', line, re.I) or line.lower().startswith('copyright ') or line.lower() == 'all rights reserved.'):
            return None
    if norm(body) == norm(templates['MIT'].split(marker, 1)[1]):
        return 'MIT'
    return None


def derive(templates):
    go.verify(BASE/'go-notice-review')
    uv.verify(BASE/'uv-workspace-review')
    source = json.loads((BASE/'go-notice-review/report.json').read_text())
    results = []
    for row in source['results']:
        if 'archiveSha256' not in row:
            continue
        module, version = go.coordinates(row['purl'])
        matches = []
        with zipfile.ZipFile(BASE/'go-notice-review/objects'/row['archiveSha256']) as z:
            for n in row['notices']:
                if '/' in n['path'] or not re.match(r'^(licen[cs]e|copying)([._-]|$)', n['path'], re.I):
                    continue
                text = z.read(module+'@'+version+'/'+n['path']).decode('utf-8')
                result = match(text, templates)
                if result:
                    matches.append({'path': n['path'], 'sha256': n['sha256'], 'observedTextId': result})
        if matches:
            results.append({'purl': row['purl'], 'archiveSha256': row['archiveSha256'], 'matches': matches,
                            'binaryIdentityProven': False, 'legalDispositionApproved': False})
    queue = json.loads(INPUT.read_bytes())
    index = {r['purl']: r for r in results}
    added = 0
    for row in queue:
        if row['reviewStatus'] == 'licence-metadata-unresolved' and row['type'] == 'go-module' and row['purl'] in index:
            row['goTextEvidence'] = index[row['purl']]
            row['reviewStatus'] = 'upstream-licence-text-observed-obligations-unreviewed'
            added += 1
    summary = {'addedTextMetadataOccurrences': added, 'remainingMissingMetadata': sum(r['reviewStatus'] == 'licence-metadata-unresolved' for r in queue), 'stage74Accepted': False, 'legalReviewComplete': False}
    return results, queue, summary


def verify(out):
    report = json.loads((out/'report.json').read_text())
    if report['inputSha256'] != sha(INPUT.read_bytes()):
        raise ValueError('Changed input')
    if set(report['templates']) != set(TEMPLATES):
        raise ValueError('Changed template set')
    templates = {}
    for name, record in report['templates'].items():
        h = record['sha256']
        if not re.fullmatch('[0-9a-f]{64}', h) or record['url'] != TEMPLATES[name]:
            raise ValueError('Changed template identity')
        data = (out/'objects'/h).read_bytes()
        if sha(data) != h or len(data) != record['bytes']:
            raise ValueError('Changed template bytes')
        templates[name] = data.decode()
    results, queue, summary = derive(templates)
    if results != report['results'] or summary != report['summary']:
        raise ValueError('Changed matching/approval')
    if queue != json.loads((out/'review-queue.json').read_text()):
        raise ValueError('Changed derived queue')
    if {p.name for p in (out/'objects').iterdir()} != {r['sha256'] for r in report['templates'].values()}:
        raise ValueError('Unexpected objects')
    return summary


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Unexpected redirect')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--verify', action='store_true')
    a = p.parse_args()
    if a.verify:
        print(json.dumps(verify(a.output), indent=2))
        return
    material = {}
    for name, url in TEMPLATES.items():
        with urllib.request.build_opener(NoRedirect()).open(url, timeout=30) as f:
            data = f.read(1024*1024+1)
        if len(data) > 1024*1024:
            raise ValueError('Template too large')
        material[name] = data
    results, queue, summary = derive({n: b.decode() for n, b in material.items()})
    a.output.mkdir(exist_ok=False)
    (a.output/'objects').mkdir()
    records = {}
    for name, data in material.items():
        h = sha(data)
        (a.output/'objects'/h).write_bytes(data)
        records[name] = {'url': TEMPLATES[name], 'sha256': h, 'bytes': len(data)}
    report = {'inputSha256': sha(INPUT.read_bytes()), 'templates': records, 'results': results, 'summary': summary,
              'limitations': ['Normalized exact text matching is evidence, not a legal opinion.', 'MIT comparison permits customary title/copyright header variation; Apache requires full normalized equality.', 'Template URLs are mutable; retained bytes are hash-bound, not authenticated signatures.', 'Nested notices, file-specific exceptions, modifications and shipped-binary/source obligations remain unreviewed.', 'No SPDX AND/OR expression for the complete module is inferred from matching a root file.']}
    (a.output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    (a.output/'review-queue.json').write_text(json.dumps(queue, indent=2)+'\n')
    print(json.dumps(verify(a.output), indent=2))


if __name__ == '__main__':
    main()
