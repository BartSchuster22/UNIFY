"""Fresh pinned, offline all-layer SBOM scans of a completed clean image build."""
import json,os,socket,subprocess,hashlib,tarfile
from pathlib import Path
from build_clean_candidate import canonical_snapshot
B=Path('/srv/alica-stage74-clean-candidate1')
SCANNER=Path('/home/deploy/stage74-syft')
PIN='abca2def61de9952fa06d3977bb1e064818facb9badfce502b450d3d6846a91f'
def sha(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def command(a):return subprocess.check_output(a,text=True,timeout=60)
def snapshot():
    ids=command(['docker','ps','-aq']).split()
    return canonical_snapshot(json.loads(command(['docker','inspect',*ids])) if ids else [])
def main():
    if os.geteuid()!=0 or socket.gethostname()!='DSH2' or sha(SCANNER)!=PIN:raise ValueError('Wrong scanner or host')
    build=json.loads((B/'build-receipt.json').read_bytes())
    verification=json.loads((B/'build-verification.json').read_bytes())
    if verification['buildReceiptSha256']!=sha(B/'build-receipt.json') or not verification.get('buildComplete') or not verification.get('originalContainersUnchanged'):raise ValueError('Build not verified')
    before=snapshot()
    if before!=canonical_snapshot(json.loads((B/'original-containers.private.json').read_bytes())):raise ValueError('Original QA changed')
    out=B/'scans';out.mkdir(mode=0o700,exist_ok=False);(out/'tmp').mkdir()
    env={**os.environ,'SYFT_CHECK_FOR_APP_UPDATE':'false','SYFT_LICENSE_CONTENT':'all','SYFT_JAVA_USE_NETWORK':'false','SYFT_JAVA_USE_MAVEN_LOCAL_REPOSITORY':'false','SYFT_GOLANG_SEARCH_REMOTE_LICENSES':'false','SYFT_GOLANG_SEARCH_LOCAL_MOD_CACHE_LICENSES':'false','SYFT_GOLANG_SEARCH_LOCAL_VENDOR_LICENSES':'false','SYFT_JAVASCRIPT_SEARCH_REMOTE_LICENSES':'false','SYFT_PYTHON_SEARCH_REMOTE_LICENSES':'false','TMPDIR':str(out/'tmp')}
    report={'schema':'stage74-clean-image-scans/v1','buildReceiptSha256':sha(B/'build-receipt.json'),'scannerSha256':PIN,'scope':'all-layers','networkEnrichment':False,'images':{},'engineeringComplete':False}
    queue=[]
    for role,r in build['images'].items():
        if sha(B/role/'image.tar')!=r['archiveSha256']:raise ValueError('Changed image archive')
        raw=out/(role+'.syft.private.json');spdx=out/(role+'.spdx.json')
        with (out/(role+'.log')).open('w') as log:
            subprocess.run([str(SCANNER),'scan','docker:'+r['imageId'],'--scope','all-layers','--parallelism','2','-o','syft-json='+str(raw),'-o','spdx-json='+str(spdx)],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=900,check=True)
        d=json.loads(raw.read_bytes())
        if d['source']['metadata']['imageID']!=r['imageId']:raise ValueError('Scanner image mismatch')
        for p in d['artifacts']:
            queue.append({'image':role,'imageId':r['imageId'],'artifactId':p['id'],'name':p['name'],'version':p.get('version'),'type':p.get('type'),'purl':p.get('purl'),'declaredLicenses':[l['value'] for l in p.get('licenses',[]) if l.get('value')],'locations':p.get('locations',[]),'engineeringDisposition':None})
        report['images'][role]={'imageId':r['imageId'],'spdxSha256':sha(spdx),'syftSha256':sha(raw),'softwareOccurrences':len(d['artifacts'])}
        (out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'role':role,**report['images'][role]}),flush=True)
    if snapshot()!=before:raise ValueError('Original QA changed during scan')
    report.update(completed=True,originalQAUnchanged=True,softwareOccurrences=len(queue),scannerMissingLicenceDeclarations=sum(not p['declaredLicenses'] for p in queue))
    (out/'review-queue.json').write_text(json.dumps(queue,indent=2)+'\n');report['queueSha256']=sha(out/'review-queue.json')
    (out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='images'}),flush=True)
if __name__=='__main__':main()
