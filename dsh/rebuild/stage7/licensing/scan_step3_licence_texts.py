"""Supplementary text recognition of existing notice evidence; not legal approval.
Offline ScanCode matching, single process, no execution of scanned material.
"""
import hashlib,importlib.metadata,io,json,resource,tarfile,time
from pathlib import Path
BASE=Path(__file__).resolve().parent;B=BASE/'clean-candidate-review';OUT=B/'step3-text-review'
def sha(data):return hashlib.sha256(data).hexdigest()
def encoded(data):return (json.dumps(data,sort_keys=True,indent=2)+'\n').encode()
def main():
    resource.setrlimit(resource.RLIMIT_AS,(1900*1024*1024,1900*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(900,900))
    from licensedcode.cache import get_index,get_licenses_db
    docs={};inputs={}
    for path,prefix in [('source-disposition-review/notice-evidence.tar','notices/'),('clean-candidate-review/steps12/metadata-evidence.tar','objects/')]:
        raw=(BASE/path).read_bytes();inputs[path]=sha(raw)
        with tarfile.open(fileobj=io.BytesIO(raw)) as t:
            for m in t.getmembers():
                if not m.isfile() or not m.name.startswith(prefix):continue
                f=t.extractfile(m)
                if f is None:raise ValueError('Missing notice member')
                data=f.read()
                if sha(data)!=m.name.split('/')[-1]:raise ValueError('Notice hash drift')
                if b'\0' in data:continue
                try:text=data.decode('utf-8')
                except UnicodeDecodeError:continue
                docs[sha(data)]=text
    OUT.mkdir(exist_ok=True);index=get_index();db=get_licenses_db();results=[]
    for i,(h,text) in enumerate(sorted(docs.items())):
        matches=index.match(query_string=text,min_score=95);found=[]
        for m in matches:
            rule=m.rule;keys=rule.license_keys();canonical={k:db[k].spdx_license_key or 'LicenseRef-scancode-'+k for k in keys}
            found.append({'expression':rule.license_expression,'spdxKeys':canonical,'score':m.score(),'coverage':m.coverage(),'startLine':m.start_line,'endLine':m.end_line,'rule':rule.identifier,'isLicenceText':rule.is_license_text,'isLicenceNotice':rule.is_license_notice,'isLicenceReference':rule.is_license_reference,'matchedText':m.matched_text()})
        results.append({'sha256':h,'bytes':len(text.encode()),'matches':found,'legalApproval':False,'scopeDetermined':False})
        if i%100==0:print(json.dumps({'documentsScanned':i,'total':len(docs)}),flush=True)
    report={'schema':'stage74-step3-text-observations/v1','toolVersion':importlib.metadata.version('scancode-toolkit'),'inputs':inputs,'documents':results,'licenceScopeAutomaticallyApproved':False}
    (OUT/'report.json').write_bytes(encoded(report));(OUT/'tool-environment.json').write_bytes(encoded({d.metadata['Name']:d.version for d in importlib.metadata.distributions()}));print(json.dumps({'documentsScanned':len(results),'reportSha256':sha(encoded(report))}))
if __name__=='__main__':main()
