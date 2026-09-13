"""Conservative additional full-document formatting observations.
Apache's non-operative application appendix may customize its single copyright
line or be absent. The complete operative terms must match; extra terms and
bundled second licences are not discarded. BSD only gains its exact title line.
"""
import argparse,collections,json,re,zipfile
from pathlib import Path
import bind_distlib as prior
import collect_go_notices as go
import match_go_licence_texts as old
import match_original_bsd as bsd
BASE=Path(__file__).resolve().parent
OUT=BASE/'format-review'

def normalize(t):return ' '.join(t.lower().split())
def apache(text,template):
    marker='END OF TERMS AND CONDITIONS'
    operative,appendix=template.split(marker,1)
    # The complete nine clauses, including the heading, are mandatory.
    if normalize(text)==normalize(operative):return 'Apache-2.0'
    if text.count(marker)!=1:return None
    actual,extra=text.split(marker,1)
    if normalize(actual)!=normalize(operative):return None
    if not extra.strip():return 'Apache-2.0'
    def copyright_line(t):return re.sub(r'(?im)^\s*Copyright[^\n]*$', 'Copyright [yyyy] [name of copyright owner]',t)
    return 'Apache-2.0' if normalize(copyright_line(extra))==normalize(copyright_line(appendix)) else None

def observe(text,templates):
    result=apache(text,templates['Apache-2.0'])
    if result:return result
    # This is not a generic prefix stripper: only the exact BSD-3 title is allowed.
    t=text.removeprefix('BSD 3-Clause License\n')
    return bsd.match(t,{n:templates[n] for n in bsd.NAMES})

def derive():
    previous=prior.derive()
    for n,b in previous.items():
        if (BASE/'distlib-review'/n).read_bytes()!=b:raise ValueError('Changed input queue')
    trecords=json.loads((BASE/'go-text-review/report.json').read_text())['templates'];templates={n:(BASE/'go-text-review/objects'/r['sha256']).read_text() for n,r in trecords.items()}
    trecords2=json.loads((BASE/'original-bsd-review/templates.json').read_text());templates.update({n:(BASE/'original-bsd-review/objects'/r['sha256']).read_text() for n,r in trecords2.items()})
    queue=json.loads(previous['review-queue.json']);sources={r['purl']:r for r in json.loads((BASE/'go-notice-review/report.json').read_bytes())['results']};added=0
    for r in queue:
        if r['type']!='go-module' or r['reviewStatus']!='licence-metadata-unresolved':continue
        source=sources[r['purl']]
        if 'archiveSha256' not in source:continue
        m,v=go.coordinates(r['purl']);refs=[]
        with zipfile.ZipFile(BASE/'go-notice-review/objects'/source['archiveSha256']) as z:
            for n in source['notices']:
                if '/' in n['path'] or not re.fullmatch(r'(?i)(license|licence|copying)([._-].*)?',n['path']):continue
                data=z.read(m+'@'+v+'/'+n['path']);observed=observe(data.decode(),templates)
                if observed:refs.append({'path':n['path'],'sha256':n['sha256'],'observedTextId':observed})
        if refs:
            r['formatTextEvidence']={'archiveSha256':source['archiveSha256'],'matches':refs,'binaryIdentityProven':False,'legalDispositionApproved':False};r['reviewStatus']='full-document-format-matched-metadata-observed-obligations-unreviewed';added+=1
    remaining={(r['image'],r['artifactId']) for r in queue if r['reviewStatus']=='licence-metadata-unresolved'};gaps=[r for r in json.loads(previous['gaps.json']) if (r['image'],r['artifactId']) in remaining];summary=json.loads(previous['summary.json']);summary.update(schema='stage74-format-review/v1',newFullDocumentFormatMatches=added,remainingMissingMetadata=len(gaps),remainingByType=dict(sorted(collections.Counter(r['type'] for r in gaps).items())))
    return {n:(json.dumps(v,indent=2)+'\n').encode() for n,v in {'review-queue.json':queue,'gaps.json':gaps,'summary.json':summary,'inputs.json':{'queueSha256':prior.context.sha(previous['review-queue.json'])}}.items()}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');a=p.parse_args();files=derive()
    if not a.verify:OUT.mkdir(exist_ok=False)
    for n,b in files.items():
        if a.verify:
            if (OUT/n).read_bytes()!=b:raise ValueError('Changed formatting evidence: '+n)
        else:(OUT/n).write_bytes(b)
    print(files['summary.json'].decode())
if __name__=='__main__':main()
