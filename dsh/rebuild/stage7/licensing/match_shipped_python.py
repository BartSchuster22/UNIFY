"""Bind exact distribution-local licence text to shipped Python SBOM occurrences.
Legal review and legal identity are explicitly outside this engineering operation.
"""
import argparse
import hashlib
import json
import posixpath
import re
import tarfile
from pathlib import Path
import match_go_licence_texts as matching
import verify_export

BASE = Path(__file__).resolve().parent
INPUT = BASE/'go-text-review/review-queue.json'
ARCHIVE = BASE/'current-qa4/review-evidence.tar.gz'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def clean(path):
    if '..' in path.split('/'):
        raise ValueError('Traversal path')
    return posixpath.normpath(path).lstrip('/')


def bind(row, notices, images, read_text, templates):
    if row['type'] != 'python' or row['reviewStatus'] != 'licence-metadata-unresolved':
        return []
    image = images[row['image']]['imageId']
    expected = re.sub('[-_.]+', '-', row['name']).lower()
    refs = []
    for loc in row['locations']:
        path = clean(loc['path'])
        parent = posixpath.dirname(path)
        suffix = '-'+row['version']+'.dist-info'
        directory = posixpath.basename(parent)
        if not directory.endswith(suffix):
            continue
        if re.sub('[-_.]+', '-', directory[:-len(suffix)]).lower() != expected:
            continue
        layer = loc['layerID']
        if image not in notices['layers'].get(layer, {}).get('images', []):
            continue
        for notice in notices['candidates']+notices['resolvedReferences']:
            if notice['layer'] != layer or not clean(notice['path']).startswith(parent+'/'):
                continue
            if 'imageId' in notice and notice['imageId'] != image:
                continue
            if not re.match(r'^(license|licence|copying)([._-]|$)', posixpath.basename(notice['path']), re.I):
                continue
            data = read_text(notice['sha256'])
            if sha(data) != notice['sha256']:
                raise ValueError('Notice hash mismatch')
            observed = matching.match(data.decode('utf-8'), templates)
            if observed:
                ref = {k: notice[k] for k in ['layer', 'path', 'sha256']}
                ref.update({'imageId': image, 'observedTextId': observed, 'relation': 'same-distribution-directory-and-layer'})
                if 'targetPath' in notice:
                    ref.update({k: notice[k] for k in ['targetLayer', 'targetPath', 'hardlink', 'linkTarget']})
                if ref not in refs:
                    refs.append(ref)
    return refs


def derive():
    verify_export.verify(BASE/'current-qa4')
    matching.verify(BASE/'go-text-review')
    template_records = json.loads((BASE/'go-text-review/report.json').read_text())['templates']
    templates = {n: (BASE/'go-text-review/objects'/r['sha256']).read_text() for n, r in template_records.items()}
    queue = json.loads(INPUT.read_bytes())
    added = 0
    with tarfile.open(ARCHIVE) as archive:
        def member(name):
            f = archive.extractfile(name)
            if f is None:
                raise ValueError('Missing regular evidence member: '+name)
            return f.read()
        index = json.loads(member('notices-run3/notice-index.json'))
        receipt = json.loads(member('run1/receipt.json'))
        def read_text(h):
            if not re.fullmatch('[0-9a-f]{64}', h):
                raise ValueError('Invalid content digest')
            return member('notices-run3/texts/'+h)
        for row in queue:
            refs = bind(row, index, receipt['images'], read_text, templates)
            if refs:
                row['shippedLicenceTextEvidence'] = refs
                row['reviewStatus'] = 'shipped-licence-text-observed-obligations-unreviewed'
                added += 1
    summary = {'addedShippedTextMetadataOccurrences': added,
               'remainingMissingMetadata': sum(r['reviewStatus'] == 'licence-metadata-unresolved' for r in queue),
               'engineeringComplete': False,
               'engineeringBlockers': ['Remaining metadata gaps', 'Shipped-identity and package-specific notice/source/build/relink dispositions incomplete', 'Original-artifact reinspection not present in this evidence set'],
               'legalIdentityAndReview': 'outside-this-engineering-scope',
               'stage74Accepted': False}
    files = {'review-queue.json': queue, 'summary.json': summary,
             'inputs.json': {'inputSha256': sha(INPUT.read_bytes()), 'reviewArchiveSha256': sha(ARCHIVE.read_bytes()), 'releaseSha256': receipt['releaseSha256']}}
    return {n: (json.dumps(v, indent=2)+'\n').encode() for n, v in files.items()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output', type=Path)
    p.add_argument('--verify', action='store_true')
    a = p.parse_args()
    files = derive()
    if a.verify:
        if {x.name for x in a.output.iterdir()} != set(files):
            raise ValueError('Changed artifact set')
        for name, data in files.items():
            if (a.output/name).read_bytes() != data:
                raise ValueError('Changed engineering evidence: '+name)
    else:
        a.output.mkdir(exist_ok=False)
        for name, data in files.items():
            (a.output/name).write_bytes(data)
    print(files['summary.json'].decode())


if __name__ == '__main__':
    main()
