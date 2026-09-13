"""Resolve exactly the frozen 34 metadata findings; do not close other obligations.
Explicit, reviewed per-coordinate decisions. No generic 'unknown => exempt' rule.
Licence bundles preserve conditional/mixed terms rather than inventing an SPDX
single-licence conclusion for an entire runtime distribution.
"""
import argparse,collections,hashlib,io,json,re,tarfile,zipfile
from pathlib import Path
import freeze_clean_candidate as freeze
BASE=Path(__file__).resolve().parent;B=BASE/'clean-candidate-review';OUT=B/'steps12'
GO={
'github.com/antlr4-go/antlr/v4':('v4.13.0','683fcd416d83b64781e229a3c2a598462fbf55c5c9fea54be244766b22c033cf','BSD-3-Clause','Three conditions, including non-endorsement; retain ANTLR copyright and complete disclaimer.'),
'github.com/caddyserver/certmagic':('v0.24.0','b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1','Apache-2.0','Complete Apache 2.0 document; appendix placeholder is not missing licence metadata.'),
'github.com/cloudflare/circl':('v1.6.1','b0da1764fe4d13d610b695536fc3f2ebc362482d053a1cd258e36975bc6b97a7','BSD-3-Clause','Cloudflare and Go copyright blocks both carry BSD-3-Clause; preserve ecc/p384 attribution too.'),
'github.com/coreos/go-oidc/v3':('v3.14.1','cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14','Apache-2.0','Complete Apache 2.0 plus distinct CoreOS NOTICE; do not drop NOTICE.'),
'github.com/dustin/go-humanize':('v1.0.1','a973b4498c13eb74baa2a8e5c351426a6826f2fcdd909916dbe53ee2e755fd71','MIT','MIT grant/condition/disclaimer followed by an informational opensource.org URL; retain full text.'),
'github.com/go-logr/logr':('v1.4.3','b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1','Apache-2.0','Complete Apache 2.0; root licence metadata resolved, obligations remain separate.'),
'github.com/google/cel-go':('v0.26.0','4cdb9af102dfbb0ca03d87d6f650a505df098646a4080f4665b389ad9c6caa02','Apache-2.0 AND BSD-3-Clause','Apache applies generally; common/types/pb/equal.go has an additional Go BSD-3-Clause block. Not Apache-only.'),
'github.com/google/go-tspi':('v0.3.0','cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14','Apache-2.0','Complete Apache 2.0 document.'),
'github.com/grpc-ecosystem/grpc-gateway/v2':('v2.27.1','a15b1d1b168954c92ff7fb1620382418f7c72f4f4d251ee791d1098ad68ab0c4','BSD-3-Clause','Gengo root and internal/casing Go attribution each have three-condition BSD terms.'),
'github.com/munnerz/goautoneg':('v0.0.0-20191010083416-a7dc8b61c822','aa1376b9bc5dea6f30cdefde40c176a254f247d2814d0a9929395138631b2ae0','BSD-3-Clause','Three unnumbered conditions include Open Knowledge Foundation non-endorsement; retain whole document.'),
'github.com/pires/go-proxyproto':('v0.8.1','666f1951be1d543e744818d232bb311a4a310fd1d344288642c796fca39af3c7','Apache-2.0','Complete Apache 2.0 with Paulo Pires appendix attribution.'),
'github.com/russross/blackfriday/v2':('v2.1.0','75e1ca97a84a9da6051dee0114333388216f2c4a5a028296b882ff3d57274735','BSD-2-Clause','Markdown quotation formatting surrounds the two-condition Simplified BSD text; no third condition.'),
'github.com/shopspring/decimal':('v1.4.0','b92ba0f6ee02f2309628bfdadb123668a17c016e475ba477b857d33470d9d625','MIT','Two MIT grants, Spring and upstream fpd/Oguz Bilgic; retain both, not just the first block.'),
'github.com/zeebo/blake3':('v0.2.4','0589f544f68ffc436e6e21efec2cf7cc2dbb2ac09ce6cb8a8cdb75ab74489716','CC0-1.0','Explicit CC0 1.0 dedication and complete legal code, including fallback licence and limitations; not an unsupported public-domain assertion.'),
'gopkg.in/yaml.v3':('v3.0.1','d18f6323b71b0b768bb5e9616e36da390fbd39369a81807cca352de4e4e6aa0b','MIT AND Apache-2.0','MIT for the enumerated libyaml-derived files; Apache 2.0 for remaining files. This is not a choice of either licence. NOTICE retained.')}
def sha(data):return hashlib.sha256(data).hexdigest()
def enc(v):return (json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def member_bytes(t,name):
    f=t.extractfile(name)
    if f is None:raise ValueError('No archive member: '+name)
    return f.read()
def require(ok,message):
    if not ok:raise ValueError(message)
def derive():
    inputs={};objects={}
    def read(path):
        raw=(BASE/path).read_bytes();inputs[str(path)]=sha(raw);return raw
    def load(path):return json.loads(read(path))
    def document(raw,origin):
        h=sha(raw);objects[h]=raw;return {'sha256':h,'bytes':len(raw),'origin':origin,'archivePath':'objects/'+h}
    for code in ['freeze_clean_candidate.py','resolve_step2_records.py','collect_step2_context.py','collect_step2_firstparty.py','collect_step2_owners.py','collect_step2_upstream.py','extract_step2_go.py','test_steps12.py']:read(code)
    lock_raw=read('clean-candidate-review/steps12/candidate-lock.json');lock=json.loads(lock_raw)
    require(lock_raw==freeze.encode(freeze.derive()),'Candidate lock drift')
    live=load('clean-candidate-review/steps12/freeze-verification.json');require(live['candidateLockSha256']==sha(lock_raw) and live['liveCandidatePinsVerified'] and live['originalQAUnchanged'],'No valid live freeze verification')
    gaps=load('clean-candidate-review/candidate-metadata-gaps.json');require(len(gaps)==34 and len({(r['image'],r['artifactId']) for r in gaps})==34,'Wrong frozen scope')
    prior=load('source-disposition-review/package-evidence.json');prior_by={(r['image'],r['artifactId']):r for r in prior}
    current=load('clean-candidate-review/candidate-package-evidence.json');current_by={(r['image'],r['artifactId']):r for r in current}
    maps={role:{x['path']:x for x in load('clean-candidate-review/'+role+'/transformation.json')['retained']} for role in lock['images']}
    for role in maps:require(inputs['clean-candidate-review/'+role+'/transformation.json']==lock['images'][role]['transformationSha256'],'Changed retained map')
    context=load('clean-candidate-review/steps12-context/report.json');up=load('clean-candidate-review/steps12-upstream/report.json');first=load('clean-candidate-review/steps12-firstparty/report.json');go=load('clean-candidate-review/step2-go-identities.json');owners=load('clean-candidate-review/step2-package-owners.json')
    go_by={r['image']:r for r in go};owner_by={r['image']:r for r in owners}
    for r in go+owners:require(maps[r['image']].get(r['path'],{}).get('sha256')==r['sha256'],'Identity evidence differs from frozen payload')
    def ctx(role,suffix):
        matches=[r for r in context['files'] if r['image']==role and r['path'].endswith(suffix)];require(len(matches)==1,'Ambiguous context '+role+suffix);r=matches[0];raw=read('clean-candidate-review/steps12-context/objects/'+r['sha256']);require(sha(raw)==r['sha256']==maps[role][r['path']]['sha256'],'Changed shipped evidence');return raw,document(raw,{'kind':'shipped','image':role,'path':r['path']})
    def upstream(ref):
        raw=read('clean-candidate-review/steps12-upstream/objects/'+ref['sha256']);require(sha(raw)==ref['sha256'],'Changed upstream bytes');return raw,document(raw,{'kind':'exact-upstream','reference':ref})
    old_tar=tarfile.open(fileobj=io.BytesIO(read('source-disposition-review/notice-evidence.tar')))
    def previous_docs(row):
        docs=[]
        for d in row['observedNoticeDocuments']:
            name=next(n for n in old_tar.getnames() if d['sha256'] in n);raw=member_bytes(old_tar,name);require(sha(raw)==d['sha256'],'Changed prior notice');docs.append(document(raw,{'kind':'previous-exact-source','path':d['path'],'package':row['name'],'version':row['version']}))
        return docs
    def verify_go_sources(row,module,version):
        import base64
        checked=[]
        for ref in row['upstreamSourceArchives']:
            raw=read(ref['path']);require(sha(raw)==ref['sha256'],'Changed Go source ZIP')
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                h=hashlib.sha256()
                for doc in row['observedNoticeDocuments']:
                    member=module+'@'+version+'/'+doc['path']
                    require(sha(z.read(member))==doc['sha256'],'Notice not bound to exact module source')
                for name in sorted(z.namelist()):
                    if not name.endswith('/'):h.update((sha(z.read(name))+'  '+name+'\n').encode())
            checksum='h1:'+base64.b64encode(h.digest()).decode();require('dep\t'+module+'\t'+version+'\t'+checksum+'\n' in go_by['caddy']['moduleInfo'],'Source ZIP does not match compiled module checksum');checked.append({**ref,'compilerModuleChecksum':checksum})
        require(checked,'No exact Go source archive');return checked
    def owned(role):
        r=owner_by[role];require(r['digestMatches'],'Owner digest mismatch');scan=load('clean-candidate-review/scans/receipt.json')
        def walk(v):
            if isinstance(v,dict):
                yield v
                for x in v.values():yield from walk(x)
            elif isinstance(v,list):
                for x in v:yield from walk(x)
        require(any(v.get('syftSha256')==r['scanSha256'] for v in walk(scan)),'Unbound package-owner scan')
        return r
    decisions=[]
    for gap in gaps:
        role,name,version=gap['image'],gap['name'],gap['version'];base=current_by[(role,gap['artifactId'])];docs=[];facts={};kind='third-party';expression=None;note=''
        if role=='caddy' and name in GO:
            v,h,expression,note=GO[name];require(version==v,'Unexpected Go version');g=go_by['caddy'];require('\ndep\t'+name+'\t'+v+'\t' in '\n'+g['moduleInfo'],'Module not present in frozen Caddy');old=prior_by[(role,gap['artifactId'])];docs=previous_docs(old);require(any(d['sha256']==h for d in docs),'Reviewed root licence differs');facts={'compilerBinarySha256':g['sha256'],'moduleVersion':v,'sourceBindings':verify_go_sources(old,name,v)}
        elif role=='caddy' and name=='github.com/klauspost/compress':
            expression='BSD-3-Clause AND Apache-2.0 AND MIT';r=up['compress'];require(version=='v1.18.0' and '\t'+r['compilerModuleChecksum']+'\n' in go_by['caddy']['moduleInfo'],'Wrong compress module');docs=[upstream(d)[1] for d in r['documents']];require(any(d['sha256']=='0d9e582ee4bff57bf1189c9e514e6da7ce277f9cd3bc2d488b22fbb39a6d87cf' for d in docs),'Unreviewed compress licence');facts=r;note='Complete root and nested licence texts: BSD default, Apache gzhttp, MIT designated subdirectories. Source module ZIP matches the h1 checksum embedded in the frozen binary; object-code subcomponent applicability remains Step 3.'
        elif role=='caddy' and name=='caddy':
            expression='Apache-2.0';g=go_by[role];require('mod\tcaddy\t(devel)' in g['moduleInfo'] and 'dep\tgithub.com/caddyserver/caddy/v2\tv2.10.2\t' in g['moduleInfo'],'Unexpected Caddy wrapper');labels=context['imageMetadata'][role]['labels'];require(labels['org.opencontainers.image.version']=='v2.10.2' and labels['org.opencontainers.image.licenses']=='Apache-2.0','Wrong vendor declaration');docs=[upstream(up['caddy']['licence'])[1]];kind='distribution-main-build-record';facts={'distributionVersion':'2.10.2','goMainModuleVersion':'(devel)','compilerBinarySha256':g['sha256'],'vendorLabels':labels};note='Scanner pseudo-version is build VCS metadata, not a published caddy module release. Identify as the Caddy 2.10.2 distribution main record, corroborated by compiled dependency and vendor declaration. Dependent modules remain separately inventoried.'
        elif name.startswith('@aquiero/'):
            expression='LicenseRef-UNIFY-FirstParty-Proprietary';kind='first-party-restricted';path=next(p['path'] for p in base['locations'] if p['path'].endswith('package.json'));raw,d=ctx(role,path.lstrip('/'));package=json.loads(raw);require(package['name']==name and package['version']==version and package['private'] is True,'Wrong first-party package');source=next(r for r in first['records'] if any(m['image']==role and m['path']==path.lstrip('/') for m in r['matches']));require(source['sha256']==sha(raw),'First-party source manifest differs');lic=next(r for r in first['records'] if r['path']=='LICENSE');text=read('clean-candidate-review/steps12-firstparty/objects/'+lic['sha256']);require(sha(text)==lic['sha256'] and b'proprietary and confidential' in text,'Wrong first-party declaration');docs=[d,document(text,lic)];facts={'sourceManifest':source,'legalHold':first['legalHold'],'newLicenceGrant':False,'exactBuildSourceCorrespondenceAsserted':False};note='Existing proprietary/restricted declaration, not SPDX Unlicense and not an OSS exemption. Package identity is byte-bound to repository manifest. Historical ALICA Ltd wording is a separate unresolved commercial/legal correction, not validated here.'
        elif role=='hermes' and name=='hermes-whatsapp-bridge':
            raw,p=ctx(role,'scripts/whatsapp-bridge/package.json');require(json.loads(raw)['name']==name and json.loads(raw)['version']==version,'Wrong bridge manifest');lic,d=ctx(role,'opt/hermes/LICENSE');require(b'MIT License' in lic and b'Nous Research' in lic,'Wrong Hermes licence');docs=[p,d];expression='MIT';note='Bridge is within the shipped Hermes repository root MIT scope. Its npm private flag is not a proprietary licence. Baileys and other dependencies retain separate records and obligations.'
        elif role=='hermes' and name=='hindsight-client':
            r=up['hindsight'];require(version=='0.6.1' and r['completeClientPayloadMatches'],'No exact client source binding');tree_raw,_=upstream(r['tree']);tree={x['path']:x['sha'] for x in json.loads(tree_raw)['tree'] if x['type']=='blob'}
            for m in r['completeClientPayloadMatches']:require(maps[role][m['installedPath']]['sha256']==m['sha256'] and tree[m['sourcePath']]==m['gitBlobSha1'],'Client payload/source changed')
            raw,p=ctx(role,'hindsight_client-0.6.1.dist-info/METADATA');wheel=next(a for a in r['artifacts'] if a['archive']['url'].endswith('.whl'));require(sha(raw)==wheel['members']['hindsight_client-0.6.1.dist-info/METADATA']['sha256'],'Different release metadata');lic=next(d for d in r['sourceDocuments'] if d['path']=='LICENSE');text,d=upstream(lic['source']);require(sha(text)=='01fde0bedf83bdc185065d7af524a61690efe576a67f922eaff3a1280c17b63a','Unreviewed Hindsight licence');docs=[p,d];expression='MIT';facts={'exactReleaseCommit':r['commit'],'verifiedClientFiles':len(r['completeClientPayloadMatches']),'registry':r['registry'],'releaseArchives':[a['archive'] for a in r['artifacts']]};note='Wheel omitted licence metadata. Installed client payload matches the published wheel and the exact tagged source tree, whose root supplies the MIT licence; this is not a name-only or latest-version inference.'
        elif name=='node':
            r=up['node-'+version];m=next(x for x in r['binaryMatches'] if x['image']==role);require(maps[role][m['path']]['sha256']==m['sha256'],'Node identity changed');text,d=upstream(r['completeLicenceBundle']);require(text.startswith(b'Node.js is licensed for use as follows:') and b'externally maintained libraries' in text,'Incomplete Node licence bundle');docs=[d];expression='LicenseRef-Node-'+version+'-Distribution';facts={'coreLicence':'MIT','runtimeArchive':r['runtimeArchive'],'vendorChecksumManifest':r['checksumManifest'],'exactBinaryMatch':m,'signaturesVerified':False};note='Exact upstream release executable matches shipped bytes. Preserve the complete Node licence bundle, including separately licensed embedded libraries; do not label the whole runtime MIT-only.'
        elif role=='hermes' and name=='github.com/docker/cli/cmd/docker':
            r=owned(role);require(r['package']=='docker-cli' and 'path\tgithub.com/docker/cli/cmd/docker\n' in go_by[role]['moduleInfo'],'Wrong Docker owner');index=load('clean-candidate-review/materials/retained-documents.json');doc=next(d for d in index if d['image']==role and d['path']=='usr/share/doc/docker-cli/copyright');archive=tarfile.open(fileobj=io.BytesIO(read('clean-candidate-review/materials/retained-notice-documents.tar')));member=next(n for n in archive.getnames() if doc['sha256'] in n);text=member_bytes(archive,member);require(sha(text)==doc['sha256']==maps[role][doc['path']]['sha256'],'Changed Docker copyright');docs=[document(text,doc)];expression='LicenseRef-Debian-DockerCLI-26.1.5-Distribution';kind='owned-binary-subrecord';facts=r;note='UNKNOWN Go main-module version resolves to Debian docker-cli 26.1.5+dfsg1-9+b13, source docker.io 26.1.5+dfsg1-9. Package-manager file digest matches this exact binary. Preserve complete Debian copyright with per-file/packaging terms; do not apply GPL packaging terms indiscriminately to all Docker code.'
        elif role=='keycloak' and name=='jrt-fs':
            r=owned(role);raw,j=ctx(role,'lib/jrt-fs.jar');release,p=ctx(role,'/release');require(b'JAVA_VERSION="21.0.6"' in release and sha(raw)==r['sha256'],'Wrong Java runtime');lic,l=ctx(role,'legal/java.base/LICENSE');assembly,a=ctx(role,'legal/java.base/ASSEMBLY_EXCEPTION');require(b'"CLASSPATH" EXCEPTION TO THE GPL' in lic and b'version 2\nonly' in assembly,'Missing conditional Java terms');docs=[j,p,l,a];expression='LicenseRef-OpenJDK-21.0.6-JRTFS-Terms';kind='owned-runtime-subrecord';facts={'owningPackage':r,'baseTerms':'GPL-2.0-only','conditionalExceptions':['Classpath exception','OpenJDK assembly exception'],'exceptionApplicabilityNotAutomaticallyGranted':True};note='JAR is byte-bound to the installed Red Hat OpenJDK package and Java 21.0.6 release. Supplied GPL and conditional exceptions are explicit, not missing metadata. Evaluate source/linking/exception applicability in Steps 3–4; do not infer an unconditional exception for every file.'
        elif role=='keycloak' and name=='quarkus-run':
            raw,j=ctx(role,'lib/quarkus-run.jar')
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                require(set(z.namelist())=={'META-INF/','META-INF/MANIFEST.MF'},'Launcher contains unassessed code');manifest=z.read('META-INF/MANIFEST.MF');require(b'Implementation-Title: Keycloak' in manifest and b'Implementation-Version: 26.0.8' in manifest,'Wrong launcher owner')
            _,l=ctx(role,'opt/keycloak/LICENSE.txt');docs=[j,l];kind='generated-launcher-descriptor';expression='Apache-2.0';facts={'containsProgramClasses':False,'owningDistribution':'Keycloak 26.0.8','classpathDependenciesNotExempted':True};note='Manifest-only launcher descriptor, not an unidentified independent Java library. Keycloak root Apache declaration retained. Referenced classpath JARs remain separately licensed/inventoried.'
        elif name=='python' and role in ['memory-v4','reference-application']:
            lic,l=ctx(role,'usr/local/lib/python3.12/LICENSE.txt');header,h=ctx(role,'include/python3.12/patchlevel.h');require(b'"3.12.14"' in header and b'PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2' in lic,'Wrong Python terms/version');docs=[l,h];expression='LicenseRef-CPython-3.12.14-Distribution';facts={'coreLicence':'PSF-2.0','historicalAndBundledTermsPreserved':True};note='Shipped version header and complete interpreter licence/history identify CPython 3.12.14. Preserve historical and bundled terms, not a PSF-only assertion for the whole distribution.'
        elif role=='postgresql' and name=='.postgresql-rundeps':
            raw,d=ctx(role,'lib/apk/db/installed');entry=next(x for x in raw.decode().split('\n\n') if '\nP:.postgresql-rundeps\n' in '\n'+x+'\n');fields=dict(line.split(':',1) for line in entry.splitlines() if ':' in line);require(fields['V']==version and fields['S']=='0' and fields['I']=='0' and fields['T']=='virtual meta package' and fields['D'],'Not a zero-payload dependency descriptor');require(not any(line.startswith(('F:','R:')) for line in entry.splitlines()),'Virtual record owns files');docs=[d];kind='zero-payload-package-manager-descriptor';expression='NONE';facts={'payloadBytes':0,'installedBytes':0,'dependencies':fields['D'].split(),'dependencyLicencesNotExempted':True};note='Generated apk virtual dependency record contains no software payload or owned files. No independent component licence applies to this record; every actual dependency remains in compliance scope.'
        elif role=='postgresql' and name=='github.com/tianon/gosu':
            r=up['gosu'];require(maps[role]['usr/local/bin/gosu']['sha256']==r['binaryMatch']['sha256'] and 'path\tgithub.com/tianon/gosu\n' in go_by[role]['moduleInfo'],'Wrong gosu binary');_,d=upstream(r['licence']);docs=[d];expression='Apache-2.0';facts={'resolvedVersion':'1.17','exactReleaseBinary':r['binaryMatch']};note='UNKNOWN Go devel module version resolves to gosu 1.17 through byte equality with its exact upstream release binary and matching image environment. Upstream 1.17 Apache licence supplied.'
        elif role=='postgresql' and name=='postgresql':
            header,h=ctx(role,'include/postgresql/server/pg_config.h');require(b'#define PG_VERSION "16.6"' in header,'Wrong PostgreSQL version');text,d=upstream(up['postgresql']['licence']);require(b'Portions Copyright (c) 1996-2024' in text and b'Permission to use, copy, modify, and distribute' in text,'Unexpected PostgreSQL copyright');docs=[h,d];expression='PostgreSQL';facts={'releaseVersion':'16.6','versionEnvironment':context['imageMetadata'][role]['versionEnvironment']};note='Installed version header and image PG_VERSION agree on 16.6; exact REL_16_6 COPYRIGHT supplies the PostgreSQL licence. This does not clear separately linked libraries.'
        else:raise ValueError('No reviewed individual decision: '+role+'/'+name)
        require(docs and expression and note,'Incomplete individual assessment')
        decisions.append({'image':role,'imageId':lock['images'][role]['imageId'],'artifactId':gap['artifactId'],'scannerName':name,'scannerVersion':version,'type':gap['type'],'classification':kind,'licenceExpression':expression,'resolution':'metadata-resolved','rationale':note,'facts':facts,'evidence':docs,'otherObligationsClosed':False,'commercialApproval':False})
    old_tar.close();require(len(decisions)==34,'Lost record')
    summary={'schema':'stage74-steps12-resolution/v1','candidateLockSha256':sha(lock_raw),'candidateFrozen':True,'scope':'Only freeze and resolve the 34 initial metadata records; not full engineering acceptance.','initialMetadataFindings':len(gaps),'individuallyResolved':len(decisions),'unresolvedMetadataFindings':0,'classifications':dict(sorted(collections.Counter(r['classification'] for r in decisions).items())),'step1Complete':True,'step2Complete':True,'engineeringComplete':False,'legalApproval':False,'fullStackRequalified':False,'firstPartyLegalHold':first['legalHold'],'otherObligationDecisionsChanged':False}
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT) as t:
        for h,data in sorted(objects.items()):
            m=tarfile.TarInfo('objects/'+h);m.size=len(data);m.mode=0o644;m.mtime=0;t.addfile(m,io.BytesIO(data))
    outputs={'individual-records.json':enc(decisions),'current-metadata-status.json':enc(summary),'remaining-metadata-findings.json':enc([]),'metadata-evidence.tar':stream.getvalue()}
    outputs['resolution-inputs.json']=enc({'inputs':inputs,'outputs':{k:sha(v) for k,v in outputs.items()},'reviewedLicenceRules':'resolve_step2_records.py explicit coordinate/hash decisions'})
    lines=['# Frozen candidate: individual metadata decisions','','Steps 1–2 only. No commercial approval or closure of other obligations.','','| Image | Scanner record | Classification | Licence metadata |','|---|---|---|---|']
    for r in decisions:lines.append('| '+ ' | '.join([r['image'],r['scannerName']+' '+r['scannerVersion'],r['classification'],r['licenceExpression']])+' |')
    lines+=['','## Individual rationale and evidence','']
    for r in decisions:lines+=['### '+r['image']+' / '+r['scannerName']+' / '+r['artifactId'],r['rationale'],'','Evidence SHA-256: '+', '.join('`'+d['sha256']+'`' for d in r['evidence']),'']
    outputs['INDIVIDUAL-RECORDS.md']=('\n'.join(lines).rstrip()+'\n').encode();return outputs

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');p.add_argument('--require-complete',action='store_true');a=p.parse_args();files=derive()
    for name,data in files.items():
        path=OUT/name
        if a.verify:require(path.read_bytes()==data,'Resolution replay differs: '+name)
        else:path.write_bytes(data)
    s=json.loads(files['current-metadata-status.json']);print(json.dumps(s))
    if a.require_complete and not(s['step1Complete'] and s['step2Complete']):raise SystemExit(2)
if __name__=='__main__':main()
