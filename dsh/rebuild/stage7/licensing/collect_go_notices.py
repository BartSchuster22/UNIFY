"""Retain exact Go proxy archives and replay notice candidates. Not legal clearance."""
import argparse
import concurrent.futures
import hashlib
import io
import json
import re
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parent
INPUT = BASE / 'registry-review-v2/review-queue.json'
LIMIT = 8 * 1024 * 1024
HOSTS = {'proxy.golang.org', 'storage.googleapis.com'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate_url(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or u.hostname not in HOSTS or u.username or u.password or u.port not in (None, 443):
        raise ValueError('Unapproved URL')


class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def coordinates(purl):
    raw = urllib.parse.unquote(purl)
    if not raw.startswith('pkg:golang/') or '?' in raw or '#' in raw:
        raise ValueError('Unsupported coordinate')
    module, version = raw[len('pkg:golang/'):].rsplit('@', 1)
    if not re.fullmatch(r'[A-Za-z0-9._~+/-]+', module) or any(p in ('', '.', '..') for p in module.split('/')) or '.' not in module.split('/')[0]:
        raise ValueError('Non-public or unsafe module path')
    if not re.fullmatch(r'v[0-9][A-Za-z0-9.+-]*', version):
        raise ValueError('Missing or unsafe version')
    return module, version


def url_for(purl):
    module, version = coordinates(purl)
    def escape(s):
        return ''.join('!' + c.lower() if c.isupper() else c for c in s)
    return 'https://proxy.golang.org/' + escape(module) + '/@v/' + escape(version) + '.zip'


def candidates(data, purl):
    module, version = coordinates(purl)
    prefix = module + '@' + version + '/'
    result = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        members = z.infolist()
        if len(members) > 100000 or sum(m.file_size for m in members) > 128 * 1024 * 1024:
            raise ValueError('Expanded archive too large')
        names = set()
        for m in members:
            if m.filename in names:
                raise ValueError('Duplicate archive member')
            names.add(m.filename)
            if not m.filename.startswith(prefix):
                raise ValueError('Module archive identity mismatch')
            rel = m.filename[len(prefix):]
            if '\\' in rel or '..' in rel.split('/') or rel.startswith('/') or (m.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe archive member')
            if m.is_dir():
                continue
            leaf = rel.rsplit('/', 1)[-1].lower()
            if not re.match(r'^(licen[cs]e|copying|copyright|notice|unlicense)([._-]|$)', leaf):
                continue
            if m.file_size > 1024 * 1024:
                raise ValueError('Notice too large')
            text = z.read(m)
            result.append({'path': rel, 'sha256': digest(text), 'bytes': len(text)})
    return sorted(result, key=lambda r: r['path'])


def collect(purl):
    row = {'purl': purl, 'legalDispositionApproved': False, 'binaryIdentityProven': False}
    try:
        url = url_for(purl)
        validate_url(url)
        with urllib.request.build_opener(Redirect()).open(url, timeout=45) as f:
            data = f.read(LIMIT + 1)
        if len(data) > LIMIT:
            raise ValueError('Compressed archive exceeds 8 MiB limit')
        notices = candidates(data, purl)
        row.update(url=url, archiveSha256=digest(data), archiveBytes=len(data), notices=notices,
                   status='notice-candidates-observed' if notices else 'no-notice-candidates')
        return row, data
    except Exception as e:
        row.update(status='unresolved', error=str(e))
        return row, None


def summary(rows, queue):
    found = {r['purl'] for r in rows if r['status'] == 'notice-candidates-observed'}
    return {'coordinates': len(rows), 'archivesRetained': sum('archiveSha256' in r for r in rows),
            'coordinatesWithNoticeCandidates': len(found),
            'inventoryOccurrencesWithNoticeCandidates': sum(r['reviewStatus'] == 'licence-metadata-unresolved' and r['purl'] in found for r in queue),
            'noticeFiles': sum(len(r.get('notices', [])) for r in rows),
            'remainingMissingMetadata': sum(r['reviewStatus'] == 'licence-metadata-unresolved' for r in queue),
            'stage74Accepted': False, 'legalReviewComplete': False}


def verify(out):
    report = json.loads((out / 'report.json').read_text())
    original = INPUT.read_bytes()
    if report['inputSha256'] != digest(original):
        raise ValueError('Changed input')
    queue = json.loads(original)
    expected = sorted({r['purl'] for r in queue if r['reviewStatus'] == 'licence-metadata-unresolved' and r['type'] == 'go-module'})
    rows = report['results']
    if [r['purl'] for r in rows] != expected:
        raise ValueError('Changed coordinate coverage')
    expected_objects = set()
    for row in rows:
        if row['legalDispositionApproved'] is not False or row['binaryIdentityProven'] is not False:
            raise ValueError('Unsupported approval')
        if row['status'] == 'unresolved':
            if 'archiveSha256' in row or 'notices' in row or not row.get('error'):
                raise ValueError('Malformed unresolved result')
            continue
        h = row['archiveSha256']
        if not re.fullmatch('[0-9a-f]{64}', h):
            raise ValueError('Unsafe hash')
        data = (out / 'objects' / h).read_bytes()
        if digest(data) != h or len(data) != row['archiveBytes'] or len(data) > LIMIT:
            raise ValueError('Archive hash/size mismatch')
        if row['url'] != url_for(row['purl']):
            raise ValueError('Changed source URL')
        notices = candidates(data, row['purl'])
        if notices != row['notices'] or row['status'] != ('notice-candidates-observed' if notices else 'no-notice-candidates'):
            raise ValueError('Changed notice extraction')
        expected_objects.add(h)
    if {p.name for p in (out / 'objects').iterdir()} != expected_objects:
        raise ValueError('Unexpected archive objects')
    computed = summary(rows, queue)
    if report['summary'] != computed:
        raise ValueError('Changed summary or approval')
    return computed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify(args.output), indent=2))
        return
    raw = INPUT.read_bytes()
    queue = json.loads(raw)
    purls = sorted({r['purl'] for r in queue if r['reviewStatus'] == 'licence-metadata-unresolved' and r['type'] == 'go-module'})
    args.output.mkdir(exist_ok=False)
    (args.output / 'objects').mkdir()
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for row, data in pool.map(collect, purls):
            if data is not None:
                (args.output / 'objects' / row['archiveSha256']).write_bytes(data)
            rows.append(row)
    report = {'schema': 'stage74-go-notice-candidates/v1', 'inputSha256': digest(raw), 'results': rows,
              'summary': summary(rows, queue),
              'limitations': ['Filename-based notice candidates are not licence classification or legal clearance.',
                             'Archive path identity is not equality with shipped binaries or Go checksum database verification.',
                             'Source/build/relink completeness and material provenance remain unreviewed.',
                             'Original review queue remains unchanged; unsuccessful collection errors are not independently replayable offline.']}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(verify(args.output), indent=2))


if __name__ == '__main__':
    main()
