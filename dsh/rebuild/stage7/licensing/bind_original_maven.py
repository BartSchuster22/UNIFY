"""Bind corrected Maven coordinates only after exact shipped/upstream JAR equality.
Filename coordinates are candidates, never accepted identity on their own.
Retains POM chains; --verify is offline, --verify-live rechecks upstream JAR bytes.
"""
import argparse, collections, hashlib, json, re, urllib.request
from pathlib import Path
import collect_registry_metadata as registry
import reinspect_original as original

BASE = Path(__file__).resolve().parent
OUT = BASE/'original-review'
INPUT = BASE/'shipped-python-review/review-queue.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def candidate(row, file):
    suffix = '.'+row['name']+'-'+row['version']+'.jar'
    leaf = file['path'].rsplit('/', 1)[-1]
    if not file['path'].startswith('opt/keycloak/lib/lib/main/') or not leaf.endswith(suffix):
        return None
    group = leaf[:-len(suffix)]
    return tuple(registry.coordinate(x) for x in (group, row['name'], row['version']))


def jar_url(coord):
    group, name, version = map(registry.coordinate, coord)
    return 'https://repo.maven.apache.org/maven2/'+group.replace('.', '/')+'/'+name+'/'+version+'/'+name+'-'+version+'.jar'


def fetch_digest(url):
    if not url.startswith('https://repo.maven.apache.org/maven2/'):
        raise ValueError('Unapproved artifact URL')
    h, count = hashlib.sha256(), 0
    with urllib.request.build_opener(registry.Redirect()).open(url, timeout=40) as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            count += len(block)
            if count > 64*1024*1024:
                raise ValueError('Upstream JAR exceeds bound')
            h.update(block)
    return h.hexdigest(), count


def files_for(row, inspection, image):
    found = []
    for loc in row['locations']:
        key = (loc['layerID'], original.safe(loc['path']))
        matches = [f for f in inspection['files'] if (f['layer'], f['path']) == key]
        if len(matches) != 1 or not matches[0]['regular']:
            return []
        f = matches[0]
        if image not in inspection['layers'][f['layer']]['images'] or f['layer'] not in inspection['images'][image]:
            raise ValueError('Image/layer mismatch')
        found.append(f)
    return found


def validate_inspection(x):
    if x['candidateArchiveSha256'] != original.ARCHIVE_SHA or x['releaseSha256'] != original.RELEASE_SHA:
        raise ValueError('Original identity mismatch')
    if x['qaBefore'] != x['qaAfter'] or any(c['running'] for c in x['qaBefore']) or x['remoteWrites']:
        raise ValueError('QA was changed or running')
    seen = set()
    for f in x['files']:
        key = (f['layer'], f['path'])
        if key in seen or original.safe(f['path']) != f['path']:
            raise ValueError('Ambiguous file reference')
        seen.add(key)
        if 'text' in f and sha(f['text'].encode()) != f['sha256']:
            raise ValueError('Changed original metadata')
        for n in f.get('nested', []):
            if sha(n['text'].encode()) != n['sha256']:
                raise ValueError('Changed nested metadata')


def load():
    import match_shipped_python
    if INPUT.read_bytes() != match_shipped_python.derive()['review-queue.json']:
        raise ValueError('Changed inherited shipped-Python queue')
    inspection = json.loads((OUT/'inspection.json').read_text())
    validate_inspection(inspection)
    images = json.loads((BASE/'current-qa4/summary.json').read_text())['images']
    queue = json.loads(INPUT.read_text())
    return inspection, images, queue


def collect():
    inspection, images, queue = load()
    registry.OUT = OUT
    (OUT/'objects').mkdir(exist_ok=False)
    results = []
    for row in queue:
        if row['type'] != 'java-archive' or row['reviewStatus'] != 'licence-metadata-unresolved':
            continue
        result = {'image': row['image'], 'artifactId': row['artifactId'], 'status': 'unresolved'}
        try:
            files = files_for(row, inspection, images[row['image']]['imageId'])
            if not files:
                raise ValueError('No regular original file at every occurrence location')
            coord = candidate(row, files[0])
            if not coord:
                raise ValueError('No coordinate candidate; not a repository-named library JAR')
            url = jar_url(coord)
            observed, count = fetch_digest(url)
            result.update(coordinate=coord, upstreamJar={'url': url, 'sha256': observed, 'bytes': count})
            if not all(f['sha256'] == observed and f['bytes'] == count for f in files):
                raise ValueError('Upstream JAR differs from original shipped bytes')
            licences, sources, inherited = registry.pom(*coord)
            result.update(declarations=licences, sources=sources, inheritedFromParent=inherited,
                          status='byte-matched-upstream-declaration' if licences else 'byte-matched-no-declaration')
        except Exception as e:
            result['error'] = str(e)
        results.append(result)
    (OUT/'maven-matches.json').write_text(json.dumps(results, indent=2)+'\n')
    return derive()


def derive(live=False):
    inspection, images, queue = load()
    results = json.loads((OUT/'maven-matches.json').read_text())
    registry.OUT = OUT
    registry.SOURCES = {}
    # Offline POM verification reuses exact original parser, with network disabled.
    for res in results:
        for source in res.get('sources', []):
            data = (OUT/'objects'/source['sha256']).read_bytes()
            if sha(data) != source['sha256'] or len(data) != source['bytes']:
                raise ValueError('POM object differs')
            registry.SOURCES[source['url']] = source
    def cached(url):
        s = registry.SOURCES[url]
        return (OUT/'objects'/s['sha256']).read_bytes(), s
    index = {}
    for res in results:
        key = (res['image'], res['artifactId'])
        if key in index:
            raise ValueError('Duplicate match record')
        index[key] = res
    expected = {(r['image'], r['artifactId']) for r in queue if r['type']=='java-archive' and r['reviewStatus']=='licence-metadata-unresolved'}
    if set(index) != expected:
        raise ValueError('Changed Maven occurrence set')
    added = 0
    gaps = []
    for row in queue:
        if row['reviewStatus'] != 'licence-metadata-unresolved':
            continue
        files = files_for(row, inspection, images[row['image']]['imageId'])
        row['originalArtifactInspection'] = [{'layer': f['layer'], 'path': f['path'], 'sha256': f['sha256']} for f in files]
        res = index.get((row['image'], row['artifactId']))
        if res and res['status'] == 'byte-matched-upstream-declaration':
            coord = tuple(res['coordinate'])
            upstream = res['upstreamJar']
            if not files or candidate(row, files[0]) != coord or upstream['url'] != jar_url(coord):
                raise ValueError('Coordinate binding differs')
            if not all(f['sha256']==upstream['sha256'] and f['bytes']==upstream['bytes'] for f in files):
                raise ValueError('Byte binding differs')
            if live and fetch_digest(upstream['url']) != (upstream['sha256'], upstream['bytes']):
                raise ValueError('Live upstream JAR differs')
            get = registry.get
            try:
                registry.get = cached
                declarations, sources, inherited = registry.pom(*coord)
            finally:
                registry.get = get
            if not declarations or declarations != res['declarations'] or sources != res['sources'] or inherited != res['inheritedFromParent']:
                raise ValueError('Declaration derivation differs')
            row['originalScannerPurl'] = row['purl']
            row['verifiedMavenPurl'] = 'pkg:maven/'+coord[0]+'/'+coord[1]+'@'+coord[2]
            row['byteMatchedRegistryEvidence'] = res
            row['reviewStatus'] = 'byte-matched-upstream-declaration-obligations-unreviewed'
            added += 1
        else:
            reason = 'No usable licence declaration in inspected original; package-specific evidence still required'
            if not files:
                reason = 'Original location is non-regular or unavailable; image-local reference resolution required'
            elif row['type'] == 'npm':
                reason = 'Original package.json has no licence declaration; private/test/example labels do not grant rights'
            elif row['type'] == 'go-module':
                reason = 'Binary bytes inspected; module-specific source/text binding still required'
            if res and res.get('error'):
                reason = res['error']
            gaps.append({'image': row['image'], 'artifactId': row['artifactId'], 'type': row['type'],
                         'name': row['name'], 'version': row['version'], 'reason': reason,
                         'originalFileEvidence': row['originalArtifactInspection']})
    summary = {'schema': 'stage74-original-review/v1', 'addedByteMatchedMetadataOccurrences': added,
               'remainingMissingMetadata': len(gaps), 'remainingByType': dict(sorted(collections.Counter(g['type'] for g in gaps).items())),
               'originalArchivesAndLayersReinspected': True, 'qaUnchangedAndStopped': True,
               'engineeringComplete': False,
               'engineeringBlockers': ['Remaining metadata gaps enumerated in gaps.json',
                                       'Package-specific notices, corresponding source, build and relink dispositions not complete across the shipped inventory'],
               'legalIdentityAndReview': 'outside-this-engineering-scope', 'stage74Accepted': False,
               'productionDistributionCleared': False}
    inputs = {n: sha((OUT/n).read_bytes()) for n in ['inspection.json', 'maven-matches.json']}
    inputs['inputQueueSha256'] = sha(INPUT.read_bytes())
    return {n:(json.dumps(v, indent=2)+'\n').encode() for n,v in
            {'review-queue.json': queue, 'gaps.json': gaps, 'summary.json': summary, 'inputs.json': inputs}.items()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--verify', action='store_true')
    p.add_argument('--verify-live', action='store_true')
    args = p.parse_args()
    files = derive(args.verify_live) if args.verify or args.verify_live else collect()
    for n, data in files.items():
        if args.verify or args.verify_live:
            if (OUT/n).read_bytes() != data:
                raise ValueError('Changed derived evidence: '+n)
        else:
            (OUT/n).write_bytes(data)
    print(files['summary.json'].decode())


if __name__ == '__main__':
    main()
