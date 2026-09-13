"""Read-only original QA4 artifact inspection; run over strictly pinned SSH.
No extraction to disk, container execution, package installation or remote writes.
REQUEST is injected by the local coordinator; stdout is the retained evidence.
"""
import hashlib, io, json, posixpath, subprocess, tarfile, zipfile
from pathlib import Path

ARCHIVE_SHA = '26f98d6ffc8ecc576628b061a9851b8cd40e1e917f070a8567b9fb48ee969553'
RELEASE_SHA = '1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c'
BASE = Path('/srv/alica-stage7-72297c3')
LIMIT = 4 * 1024 * 1024


def digest(stream):
    h = hashlib.sha256()
    for b in iter(lambda: stream.read(1024*1024), b''):
        h.update(b)
    return h.hexdigest()


def safe(name):
    if '..' in name.split('/'):
        raise ValueError('Traversal path')
    return posixpath.normpath(name).lstrip('/')


def nested_metadata(data):
    records = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = set()
        for m in z.infolist():
            name = safe(m.filename)
            if name in names:
                raise ValueError('Duplicate ZIP member')
            names.add(name)
            leaf = name.rsplit('/', 1)[-1].lower()
            if m.is_dir() or not (leaf in {'pom.xml', 'pom.properties', 'manifest.mf'} or leaf.startswith(('license', 'licence', 'notice', 'copying'))):
                continue
            if m.file_size > LIMIT:
                raise ValueError('Nested metadata exceeds bound')
            raw = z.read(m)
            records.append({'path': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'text': raw.decode('utf-8', errors='strict')})
    return records


def snapshot():
    ids = subprocess.check_output(['docker', 'ps', '-aq'], text=True).split()
    cs = json.loads(subprocess.check_output(['docker', 'inspect'] + ids))
    result = []
    for c in cs:
        if c['State']['Running']:
            raise ValueError('QA must remain stopped')
        result.append({'id': c['Id'], 'name': c['Name'], 'image': c['Image'],
                       'startedAt': c['State']['StartedAt'], 'finishedAt': c['State']['FinishedAt'],
                       'running': c['State']['Running'], 'restartCount': c['RestartCount'],
                       'mounts': sorted((m['Source'], m['Destination']) for m in c['Mounts'])})
    return sorted(result, key=lambda x: x['id'])


def collect(request):
    before = snapshot()
    bundle = BASE/'bundle'
    with (BASE/'dsh-stage7-qa4-72297c3-linux-amd64.tar.gz').open('rb') as f:
        if digest(f) != ARCHIVE_SHA:
            raise ValueError('Original candidate digest changed')
    # Verify every original member and corresponding unpacked bundle member.
    members = {}
    with tarfile.open(BASE/'dsh-stage7-qa4-72297c3-linux-amd64.tar.gz', 'r|gz') as t:
        for m in t:
            if not m.isfile() or len(m.name.split('/')) != 2 or not m.name.startswith('bundle/') or m.name in members:
                raise ValueError('Unexpected original bundle member')
            members[m.name] = digest(t.extractfile(m))
            p = BASE/m.name
            if p.is_symlink():
                raise ValueError('Unpacked bundle symlink')
            with p.open('rb') as f:
                if digest(f) != members[m.name]:
                    raise ValueError('Unpacked member differs')
    if members['bundle/release.json'] != RELEASE_SHA:
        raise ValueError('Release mismatch')
    release = json.loads((bundle/'release.json').read_text())
    for name, sha in release['files'].items():
        if members.get('bundle/'+name) != sha:
            raise ValueError('Manifest member mismatch')
    requested = {}
    for row in request:
        for loc in row['locations']:
            requested.setdefault(loc['layerID'], set()).add(safe(loc['path']))
    layers, images, files = {}, {}, []
    for archive_name in ['images.tar', 'reference-image.tar']:
        with tarfile.open(bundle/archive_name) as outer:
            manifest = json.load(outer.extractfile('manifest.json'))
            owners = {}
            for im in manifest:
                config = outer.extractfile(im['Config']).read()
                image = 'sha256:'+hashlib.sha256(config).hexdigest()
                images[image] = ['sha256:'+Path(x).name for x in im['Layers']]
                for layer in im['Layers']:
                    owners.setdefault(layer, []).append(image)
            for layer, owned in owners.items():
                ld = 'sha256:'+Path(layer).name
                if ld in layers:
                    layers[ld]['images'] = sorted(set(layers[ld]['images'] + owned))
                    continue
                if 'sha256:'+digest(outer.extractfile(layer)) != ld:
                    raise ValueError('Layer content digest mismatch')
                layers[ld] = {'images': sorted(owned), 'archive': archive_name}
                targets = requested.get(ld, set())
                if not targets:
                    continue
                seen = set()
                with tarfile.open(fileobj=outer.extractfile(layer), mode='r|*') as inner:
                    for m in inner:
                        path = safe(m.name)
                        if path not in targets:
                            continue
                        if path in seen:
                            raise ValueError('Ambiguous repeated target in layer')
                        seen.add(path)
                        rec = {'layer': ld, 'path': path, 'bytes': m.size, 'regular': m.isfile()}
                        if m.isfile():
                            if path.endswith('.jar'):
                                if m.size > 64*1024*1024:
                                    raise ValueError('JAR exceeds bound')
                                data = inner.extractfile(m).read()
                                rec['sha256'] = hashlib.sha256(data).hexdigest()
                                rec['nested'] = nested_metadata(data)
                            elif path.endswith(('package.json', '/METADATA', '/installed')) or '/var/lib/dpkg/status.d/' in '/'+path:
                                if m.size > LIMIT:
                                    raise ValueError('Metadata exceeds bound')
                                data = inner.extractfile(m).read()
                                rec.update(sha256=hashlib.sha256(data).hexdigest(), text=data.decode('utf-8'))
                            else:
                                rec['sha256'] = digest(inner.extractfile(m))
                        else:
                            rec['linkTarget'] = m.linkname
                        files.append(rec)
    expected = {v['imageId'] for v in REQUEST_IMAGES.values()}
    if not expected.issubset(images):
        raise ValueError('Previously collected image identity missing')
    after = snapshot()
    if before != after:
        raise ValueError('QA state changed')
    return {'schema': 'stage74-original-reinspection/v1', 'candidateArchiveSha256': ARCHIVE_SHA,
            'releaseSha256': RELEASE_SHA, 'bundleMembers': members, 'images': images, 'layers': layers,
            'files': files, 'qaBefore': before, 'qaAfter': after, 'remoteWrites': False,
            'scope': 'original archive, unpacked bundle, all image-layer hashes, requested unresolved package files',
            'legalReviewComplete': False, 'engineeringComplete': False}


if __name__ == '__main__':
    print(json.dumps(collect(REQUEST), sort_keys=True))
