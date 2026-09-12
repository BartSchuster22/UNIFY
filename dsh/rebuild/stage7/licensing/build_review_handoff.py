"""Generate/replay a review-only obligation worksheet and upstream notice candidate bundle."""
import argparse
import collections
import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path
import collect_go_notices as go
import collect_uv_workspace as uv

BASE = Path(__file__).resolve().parent


def render(go_text=False):
    go.verify(BASE/'go-notice-review')
    uv.verify(BASE/'uv-workspace-review')
    if go_text:
        import match_go_licence_texts as matcher
        matcher.verify(BASE/'go-text-review')
    queue_bytes = (BASE/('go-text-review/review-queue.json' if go_text else 'uv-workspace-review/review-queue.json')).read_bytes()
    queue = json.loads(queue_bytes)
    out = io.StringIO(newline='')
    writer = csv.writer(out)
    writer.writerow(['image', 'artifact_id', 'name', 'version', 'type', 'purl', 'evidence_status', 'declared_licences', 'upstream_workspace_declaration', 'locations', 'required_review', 'legal_disposition_approved'])
    for r in queue:
        writer.writerow([r['image'], r['artifactId'], r['name'], r['version'], r['type'], r['purl'], r['reviewStatus'], json.dumps(r['declaredLicenses']), r.get('workspaceEvidence', {}).get('declaration', ''), json.dumps(r['locations']), 'Bind to shipped materials; determine all applicable licences; verify notice/source/build/relink duties and delivery; record reviewer disposition', 'false'])
    report = json.loads((BASE/'go-notice-review/report.json').read_text())
    text = ['REVIEW-ONLY UPSTREAM NOTICE CANDIDATES\nNot a complete or approved product NOTICE. Do not install as final release material.\nArchives/filenames are evidence, not proof of shipped identity or applicability.\n']
    for r in report['results']:
        if 'archiveSha256' not in r:
            continue
        module, version = go.coordinates(r['purl'])
        with zipfile.ZipFile(BASE/'go-notice-review/objects'/r['archiveSha256']) as z:
            for n in r['notices']:
                data = z.read(module+'@'+version+'/'+n['path'])
                text.append('\n===== '+r['purl']+' :: '+n['path']+' =====\nSHA256: '+n['sha256']+'\nSource: '+r['url']+'\n\n'+data.decode('utf-8', errors='backslashreplace')+'\n')
    missing = collections.Counter(r['type'] for r in queue if r['reviewStatus'] == 'licence-metadata-unresolved')
    status = {'reviewOnly': True, 'stage74Accepted': False, 'legalReviewComplete': False,
              'inputQueueSha256': hashlib.sha256(queue_bytes).hexdigest(), 'inventoryOccurrences': len(queue),
              'remainingMissingMetadataByType': dict(sorted(missing.items())), 'remainingMissingMetadata': sum(missing.values()),
              'goNoticeCandidates': report['summary'],
              'blockers': ['Package-specific provenance and complete licence obligation dispositions remain open.',
                           'Local npm workspace packages must not be mapped to name-colliding public registry packages.',
                           'Three oversized Go archives and three invalid/missing coordinates remain uncollected.',
                           'Full legal name/contact and appropriate completed agreement review are outstanding.',
                           'Final approved immutable assembly has not been produced; this is a review handoff.']}
    return {'pending-dispositions.csv': out.getvalue().encode(), 'GO-NOTICE-CANDIDATES.txt': ''.join(text).encode(), 'status.json': (json.dumps(status, indent=2)+'\n').encode()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--verify', action='store_true')
    p.add_argument('--go-text', action='store_true', help='Use the later exact-text-matched queue; preserve original handoff by default')
    a = p.parse_args()
    files = render(a.go_text)
    manifest = {name: {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)} for name, data in files.items()}
    files['manifest.json'] = (json.dumps(manifest, indent=2)+'\n').encode()
    if a.verify:
        if {p.name for p in a.output.iterdir()} != set(files):
            raise ValueError('Unexpected handoff files')
        for name, data in files.items():
            if (a.output/name).read_bytes() != data:
                raise ValueError('Changed handoff: '+name)
        print('PASS: full handoff replay; acceptance remains BLOCKED')
    else:
        a.output.mkdir(exist_ok=False)
        for name, data in files.items():
            (a.output/name).write_bytes(data)
        print('Created review-only handoff; acceptance remains BLOCKED')


if __name__ == '__main__':
    main()
