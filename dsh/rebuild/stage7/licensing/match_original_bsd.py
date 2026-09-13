"""Full-body BSD text observations with narrowly documented formatting variants.
No compound SPDX expression, binary/source equivalence, or legal clearance inferred.
"""
import argparse, collections, hashlib, json, re, urllib.request, zipfile
from pathlib import Path
import collect_go_notices as go
import bind_original_maven as original

BASE = Path(__file__).resolve().parent
OUT = BASE/'original-bsd-review'
NAMES = ['BSD-2-Clause', 'BSD-3-Clause']
URLS = {n:'https://raw.githubusercontent.com/spdx/license-list-data/main/text/'+n+'.txt' for n in NAMES}


def norm_body(body):
    # Only list markers at the beginning of a line are interchangeable.
    body = re.sub(r'(?m)^\s*(?:[123]\.|\*)\s+', '', body)
    return ' '.join(body.lower().split())


def body(text):
    marker = 'Redistribution and use in source and binary forms'
    if marker not in text:
        return None
    header, rest = text.split(marker, 1)
    for line in header.splitlines():
        line = line.strip()
        if line and not (line.lower().startswith('copyright ') or line.lower() == 'all rights reserved.'):
            return None
    return norm_body(marker+rest)


def match(text, templates):
    actual = body(text)
    if actual is None:
        return None
    for name in NAMES:
        reference = body(templates[name])
        if reference is None:
            raise ValueError('Invalid BSD reference template')
        pattern = re.escape(reference)
        # Retain all substantive clauses. Only these two conventional noun
        # substitutions are accepted; full-string matching rejects extra terms.
        pattern = pattern.replace(re.escape('in no event shall the copyright holder or contributors'),
                                  re.escape('in no event shall the copyright ')+r'(?:holder|owner)'+re.escape(' or contributors'))
        if name == 'BSD-3-Clause':
            pattern = pattern.replace(re.escape('neither the name of the copyright holder nor'),
                                      re.escape('neither the name of ')+r'(?:the copyright holder|Google LLC|Google Inc\.)'.lower()+re.escape(' nor'))
        if re.fullmatch(pattern, actual):
            return name
    return None


def derive(templates):
    # Replay upstream archive hashes and the original byte-binding derivation.
    go.verify(BASE/'go-notice-review')
    prior = original.derive()
    for n, data in prior.items():
        if (BASE/'original-review'/n).read_bytes() != data:
            raise ValueError('Changed original review')
    queue = json.loads(prior['review-queue.json'])
    source = json.loads((BASE/'go-notice-review/report.json').read_text())
    idx = {r['purl']:r for r in source['results']}
    added = 0
    for row in queue:
        if row['type'] != 'go-module' or row['reviewStatus'] != 'licence-metadata-unresolved':
            continue
        r = idx.get(row['purl'], {})
        if 'archiveSha256' not in r:
            continue
        module, version = go.coordinates(row['purl'])
        refs = []
        with zipfile.ZipFile(BASE/'go-notice-review/objects'/r['archiveSha256']) as z:
            for n in r['notices']:
                if '/' in n['path'] or not re.fullmatch(r'(?i)(license|licence|copying)([._-].*)?', n['path']):
                    continue
                data = z.read(module+'@'+version+'/'+n['path'])
                observed = match(data.decode('utf-8'), templates)
                if observed:
                    refs.append({'path':n['path'], 'sha256':n['sha256'], 'observedTextId':observed})
        if refs:
            row['bsdTextEvidence'] = {'archiveSha256':r['archiveSha256'], 'matches':refs,
                                      'binarySourceIdentityProven':False, 'legalDispositionApproved':False}
            row['reviewStatus'] = 'upstream-bsd-text-observed-obligations-unreviewed'
            added += 1
    remaining = {(r['image'], r['artifactId']) for r in queue if r['reviewStatus']=='licence-metadata-unresolved'}
    gaps = [r for r in json.loads(prior['gaps.json']) if (r['image'],r['artifactId']) in remaining]
    summary = json.loads(prior['summary.json'])
    summary.update(schema='stage74-original-bsd-review/v1', addedBsdTextMetadataOccurrences=added,
                   remainingMissingMetadata=len(gaps), remainingByType=dict(sorted(collections.Counter(g['type'] for g in gaps).items())))
    return {n:(json.dumps(v,indent=2)+'\n').encode() for n,v in {'review-queue.json':queue,'gaps.json':gaps,'summary.json':summary}.items()}


def run(verify=False):
    if verify:
        records=json.loads((OUT/'templates.json').read_text())
        if set(records)!=set(NAMES):raise ValueError('Changed template set')
        templates={}
        for n,r in records.items():
            if r['url']!=URLS[n] or not re.fullmatch('[a-f0-9]{64}',r['sha256']):raise ValueError('Changed template identity')
            data=(OUT/'objects'/r['sha256']).read_bytes()
            if original.sha(data)!=r['sha256'] or len(data)!=r['bytes']:raise ValueError('Changed template object')
            templates[n]=data.decode()
        if {p.name for p in (OUT/'objects').iterdir()}!={r['sha256'] for r in records.values()}:raise ValueError('Unexpected object')
    else:
        OUT.mkdir(exist_ok=False);(OUT/'objects').mkdir();records={};templates={}
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*a,**kw):raise ValueError('Unexpected redirect')
        for n,url in URLS.items():
            with urllib.request.build_opener(NoRedirect()).open(url,timeout=30) as f:data=f.read(1024*1024+1)
            if len(data)>1024*1024:raise ValueError('Oversize template')
            h=original.sha(data);(OUT/'objects'/h).write_bytes(data);records[n]={'url':url,'sha256':h,'bytes':len(data)};templates[n]=data.decode()
        (OUT/'templates.json').write_text(json.dumps(records,indent=2)+'\n')
    files=derive(templates)
    files['inputs.json']=(json.dumps({'originalQueueSha256':original.sha((BASE/'original-review/review-queue.json').read_bytes()),'templatesSha256':original.sha((OUT/'templates.json').read_bytes())},indent=2)+'\n').encode()
    for n,data in files.items():
        if verify:
            if (OUT/n).read_bytes()!=data:raise ValueError('Changed derived evidence: '+n)
        else:(OUT/n).write_bytes(data)
    print(files['summary.json'].decode())


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');run(p.parse_args().verify)
