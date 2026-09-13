"""Step-3 grouping and obligation decisions. Unknown/custom terms stay blocked.
No package is cleared just because it shares a licence label or container.
Decisions describe requirements, not Step-4 fulfilment or legal approval.
"""
import argparse,collections,csv,hashlib,io,json,posixpath,re,tarfile
from pathlib import Path
import freeze_clean_candidate as freeze
import resolve_step2_records as step2
BASE=Path(__file__).resolve().parent;B=BASE/'clean-candidate-review';OUT=B/'step3'
def sha(b):return hashlib.sha256(b).hexdigest()
def enc(v):return (json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def need(ok,message):
    if not ok:raise ValueError(message)
PERMISSIVE={'MIT','ISC','BSD-2-Clause','BSD-3-Clause','BSD-4-Clause','BSD-1-Clause','0BSD','Apache-2.0','Apache-1.1','Zlib','BSL-1.0','BlueOak-1.0.0','Unlicense','CC0-1.0','X11','curl','HPND','HPND-sell-variant','MIT-CMU','ICU','Unicode-DFS-2016','Unicode-3.0','Unicode-TOU','PSF-2.0','Python-2.0','Python-2.0.1','PostgreSQL','MIT-0','WTFPL','WTFPL-2.0','FSFAP','FSFUL','FSFULLR','OpenSSL','SSLeay-standalone','OLDAP-2.8','EDL-1.0','MIT-Modern-Variant'}
ALIASES={'MIT License':'MIT','Expat':'MIT','expat':'MIT','BSD-2-clause':'BSD-2-Clause','BSD-3-clause':'BSD-3-Clause','BSD-4-clause':'BSD-4-Clause','BSD-1-clause':'BSD-1-Clause','BSD-2':'BSD-2-Clause','BSD-3':'BSD-3-Clause','BSD3':'BSD-3-Clause','3-Clause BSD License':'BSD-3-Clause','BSD-4':'BSD-4-Clause','BSL':'BSL-1.0','BSL-1':'BSL-1.0','Boost':'BSL-1.0','Boost-1.0':'BSL-1.0','ZLIB':'Zlib','zlib':'Zlib','PSFL':'PSF-2.0','MPLv2.0':'MPL-2.0','MPL-2':'MPL-2.0','Apache-2':'Apache-2.0','Apache 2.0':'Apache-2.0','Apache License 2.0':'Apache-2.0','Apache License, Version 2.0':'Apache-2.0','The Apache Software License, Version 2.0':'Apache-2.0','The Apache License, Version 2.0':'Apache-2.0','EDL 1.0':'EDL-1.0','Eclipse Public License - v 2.0':'EPL-2.0','CC0':'CC0-1.0','WTFPL-2':'WTFPL-2.0','SIL-OFL-1.1':'OFL-1.1','bitstream-vera':'Bitstream-Vera'}
for family in ['GPL','LGPL']:
    for version in (['1','2','3'] if family=='GPL' else ['2','2.1','3']):
        v=version if '.' in version else version+'.0'
        for label in [family+'-'+version,family+'v'+version,family+'-'+v]:
            ALIASES[label]=family+'-'+v+'-only';ALIASES[label+'+']=family+'-'+v+'-or-later'
def normalize(value):
    value=value.strip().strip('"')
    if ';link=' in value:value=value.split(';link=',1)[0].strip('"')
    if value in ALIASES:return ALIASES[value]
    if re.fullmatch(r'https?://(?:www\.)?apache.org/licenses/LICENSE-2.0(?:\.txt|\.html)?',value) or value in ['http://repository.jboss.org/licenses/apache-2.0.txt','https://repository.jboss.org/licenses/apache-2.0.txt']:return 'Apache-2.0'
    if value in ['https://opensource.org/licenses/BSD-3-Clause','http://www.opensource.org/licenses/mit-license.php','http://www.eclipse.org/org/documents/edl-v10.php']:return {'https://opensource.org/licenses/BSD-3-Clause':'BSD-3-Clause','http://www.opensource.org/licenses/mit-license.php':'MIT','http://www.eclipse.org/org/documents/edl-v10.php':'EDL-1.0'}[value]
    return value
def parse_expression(expression):
    # No slash/comma rewriting, no inferred alternatives or discarded exceptions.
    tokens=re.findall(r'\(|\)|[A-Za-z0-9.+-]+',expression)
    if ''.join(tokens)!=re.sub(r'\s+','',expression):raise ValueError('Non-SPDX syntax')
    at=0
    def atom():
        nonlocal at
        if at>=len(tokens):raise ValueError('Missing licence')
        if tokens[at]=='(':
            at+=1;node=choice()
            if at>=len(tokens) or tokens[at]!=')':raise ValueError('Missing parenthesis')
            at+=1;return node
        name=tokens[at];at+=1
        if name in ['AND','OR','WITH',')']:raise ValueError('Expected licence')
        node=['licence',normalize(name)]
        if at<len(tokens) and tokens[at]=='WITH':
            at+=1
            if at>=len(tokens):raise ValueError('Missing exception')
            node=['with',node,tokens[at]];at+=1
        return node
    def conjunction():
        nonlocal at
        nodes=[atom()]
        while at<len(tokens) and tokens[at]=='AND':at+=1;nodes.append(atom())
        return nodes[0] if len(nodes)==1 else ['and',*nodes]
    def choice():
        nonlocal at
        nodes=[conjunction()]
        while at<len(tokens) and tokens[at]=='OR':at+=1;nodes.append(conjunction())
        return nodes[0] if len(nodes)==1 else ['or',*nodes]
    result=choice()
    if at!=len(tokens):raise ValueError('Unexpected licence tokens')
    return result

def flatten(node):
    if node[0]=='licence':return [node[1]]
    if node[0]=='with':return flatten(node[1])+['WITH '+node[2]]
    return [v for child in node[1:] for v in flatten(child)]
def licence_profile(expressions):
    terms=[];unknown=[];trees=[];selected=[]
    for value in expressions:
        value=normalize(value)
        try:tree=parse_expression(value)
        except ValueError:unknown.append(value);continue
        trees.append(tree)
        # Select a permissive alternative only from a literal, flat OR expression.
        if tree[0]=='or' and all(n[0]=='licence' for n in tree[1:]):
            options=[n[1] for n in tree[1:]];choice=next((n for n in ['MIT','0BSD','BSD-2-Clause','BSD-3-Clause','Apache-2.0','MPL-2.0'] if n in options),None)
            if choice:terms.append(choice);selected.append({'expression':value,'selected':choice,'basis':'explicit flat OR; not array/comma/slash inference'});continue
        terms.extend(flatten(tree))
    families=set()
    for t in terms:
        if t in PERMISSIVE:families.add('permissive')
        elif t in {f'{family}-{version}-{suffix}' for family,versions in {'GPL':['1.0','2.0','3.0'],'AGPL':['1.0','3.0'],'LGPL':['2.0','2.1','3.0']}.items() for version in versions for suffix in ['only','or-later']}:families.add('network-copyleft' if t.startswith('AGPL') else 'library-copyleft' if t.startswith('LGPL') else 'strong-copyleft')
        elif t in ['MPL-2.0','MPL-1.1','EPL-1.0','EPL-2.0','CDDL-1.0','CDDL-1.1']:families.add('file-or-module-copyleft')
        elif t.startswith(('CC-BY-','CC-BY-SA-','GFDL-')) or t=='OFL-1.1':families.add('documentation-or-font')
        else:unknown.append(t)
    return {'expressions':expressions,'syntaxTrees':trees,'terms':sorted(set(terms)),'families':sorted(families),'selectedAlternatives':selected,'unresolvedTerms':sorted(set(unknown))}
def observed_ids(value):
    result=[]
    if isinstance(value,dict):
        if isinstance(value.get('observedTextId'),str):result.append(value['observedTextId'])
        for v in value.values():result.extend(observed_ids(v))
    elif isinstance(value,list):
        for v in value:result.extend(observed_ids(v))
    return result

def requirements(profile,context):
    unresolved=profile['unresolvedTerms'];families=set(profile['families']);terms=set(profile['terms']);result={};blockers=[]
    def put(key,status,reason):result[key]={'applicability':status,'basis':reason,'fulfilled':False}
    put('noticeDelivery','required','DSH distribution policy retains complete scoped copyright/licence/NOTICE material; licence-specific mandatory notices remain binding. No delivery asserted here.')
    if unresolved or not terms:
        for k in ['correspondingSource','buildInstructions','relinkOrReplacement','licenceCompatibility']:put(k,'blocked','Resolve exact scoped terms before deciding applicability; do not treat a bundle or custom label as permissive.')
        blockers.append({'code':'unresolved-licence-scope','terms':unresolved or profile['expressions'],'action':'Review the attached actual notice bundle and resolve file/exception/custom-term scope for this component.'})
        return result,blockers
    copy=bool(families & {'strong-copyleft','network-copyleft','library-copyleft','file-or-module-copyleft'})
    put('correspondingSource','required' if copy else 'not-required','Supply exact covered component source, modifications and applicable scripts; preserve separate per-file grants.' if copy else 'Selected listed permissive terms do not require corresponding-source distribution; other embedded components are assessed separately.')
    put('buildInstructions','required' if families & {'strong-copyleft','network-copyleft','library-copyleft'} else 'not-required','Covered GPL/LGPL corresponding source must include applicable build/install/control scripts; do not equate an upstream archive with complete corresponding source.' if families & {'strong-copyleft','network-copyleft','library-copyleft'} else 'No separate build-script delivery requirement under these selected terms; source-form and modification requirements still apply where specified.')
    if 'library-copyleft' in families:
        if context['kind']=='jvm-jar':reason='Provide covered library source plus a replaceable JAR/re-augmentation mechanism; verify the mechanism in Step 4, otherwise supply required application/relink materials. Permit necessary modification and reverse engineering.'
        elif context['kind']=='python-source-or-extension':reason='Supply LGPL library source and preserve user replacement/import of modified library; verify required combined-work materials and reverse-engineering permission in Step 4. Native extensions are separately listed.'
        elif context['kind']=='embedded-compiled-component':reason='Embedded LGPL code requires applicable combined-work/relink materials; no shared-library exemption inferred for statically incorporated code.'
        else:reason='Supply applicable LGPL source and a suitable replacement/relink mechanism for the identified native consumers. ELF evidence alone does not prove replacement works; verify in Step 4.'
        put('relinkOrReplacement','required',reason)
    else:put('relinkOrReplacement','not-required','No LGPL-specific object/relink-kit requirement under selected terms. Strong-copyleft complete-source and compatibility duties are separate and are not waived.')
    put('licenceCompatibility','required' if copy else 'not-required','Review combination at the identified program/module boundary, not all co-container software; no automatic exception, aggregate relicensing or first-party disclosure conclusion.' if copy else 'Selected permissive terms impose no copyleft licensing of independent callers; preserve their notices and grants.')
    if 'network-copyleft' in families:put('networkSourceOffer','required','For modified AGPL network-interactive program, supply the required prominent corresponding-source opportunity to remote users; do not substitute an offline-only notice.')
    if 'Apache-2.0' in terms:put('apacheNoticesChangesPatents','required','Apache 2 sections 3–4: preserve applicable NOTICE and attribution, licence text and prominent modified-file notices; patent termination and trademark limits remain. No endorsement/trademark grant.')
    if 'BSD-4-Clause' in terms:put('advertisingAcknowledgement','required','Retain the applicable four-clause BSD advertising acknowledgement; do not silently apply a later revocation without scope evidence.')
    if terms & {'BSD-3-Clause','BSD-4-Clause','X11'}:put('nonEndorsement','required','Do not use upstream names to endorse/promote derived products without permission.')
    if 'Zlib' in terms:put('originAndChanges','required','Do not misrepresent origin; mark altered source versions and preserve required notices.')
    if terms & {'EPL-1.0','EPL-2.0'}:put('eplCommercialTerms','required','Provide required source availability information and preserve recipient rights; assess commercial-contributor defence/indemnification obligations under the supplied EPL text.')
    if 'documentation-or-font' in families:
        put('contentSpecificTerms','blocked','Determine attribution/share-alike, invariant sections/cover texts or reserved font names against the actual distributed content, not executable-code assumptions.');blockers.append({'code':'content-licence-scope','terms':sorted(terms),'action':'Map supplied documentation/font terms to retained content and decide reserved-name/invariant/attribution requirements.'})
    return result,blockers

def derive():
    inputs={}
    def read(path):data=(BASE/path).read_bytes();inputs[path]=sha(data);return data
    def load(path):return json.loads(read(path))
    for name,data in step2.derive().items():need((step2.OUT/name).read_bytes()==data,'Step 2 replay changed')
    lock=load('clean-candidate-review/steps12/candidate-lock.json');need(freeze.encode(freeze.derive())==enc(lock),'Candidate drift')
    q=load('clean-candidate-review/candidate-package-evidence.json');overlay={(r['image'],r['artifactId']):r for r in load('clean-candidate-review/steps12/individual-records.json')};old={(r['image'],r['artifactId']):r for r in load('source-disposition-review/package-evidence.json')};meta={(r['image'],r['artifactId']):r for r in load('go-origin-review/review-queue.json')};c=load('clean-candidate-review/step3-context.json');need(c['candidateLockSha256']==sha(enc(lock)) and c['originalQAUnchanged'] and not c['payloadExecuted'],'Wrong context candidate')
    contexts={(r['image'],r['artifactId']):r for r in c['packages']};need(set(contexts)=={(r['image'],r['artifactId']) for r in q},'Incomplete/duplicate context scope');need(len(contexts)==len(c['packages'])==len(q),'Duplicate occurrence')
    scan=load('clean-candidate-review/scans/receipt.json')
    def leaves(x):
        if isinstance(x,dict):
            yield x
            for v in x.values():yield from leaves(v)
        elif isinstance(x,list):
            for v in x:yield from leaves(v)
    for role,h in c['scannerInputs'].items():need(scan['images'][role]['syftSha256']==h and scan['images'][role]['imageId']==lock['images'][role]['imageId'],'Context scanner drift')
    maps={role:{r['path']:r for r in load('clean-candidate-review/'+role+'/transformation.json')['retained']} for role in lock['images']}
    native={(r['image'],r['path']):r for r in c['nativePayloads']};sonames=collections.defaultdict(list)
    for key,r in native.items():
        need(maps[r['image']][r['path']]['sha256']==r['sha256'],'Native payload drift')
        if r.get('soname'):sonames[(r['image'],r['soname'])].append(r['path'])
    edges=[]
    for (role,path),r in native.items():
        for name in r.get('needed',[]):edges.append({'image':role,'consumer':path,'needed':name,'candidateProviders':sonames.get((role,name),[]),'resolution':'candidate SONAME match, not full loader/dlopen resolution'})
    incoming=collections.defaultdict(list);outgoing=collections.defaultdict(list)
    for edge in edges:
        role=edge['image'];item={'consumerSha256':native[(role,edge['consumer'])]['sha256'],'needed':edge['needed'],'candidateProviderSha256s':sorted({native[(role,p)]['sha256'] for p in edge['candidateProviders']})}
        outgoing[(role,edge['consumer'])].append(item)
        for p in edge['candidateProviders']:incoming[(role,p)].append(item)
    owners=collections.defaultdict(list)
    for r in c['packages']:
        for p in r['nativePaths']:owners[(r['image'],p)].append(r['artifactId'])
    text_report=load('clean-candidate-review/step3-text-review/report.json')
    for path,h in text_report['inputs'].items():need(sha(read(path))==h,'Text-review input drift')
    text_docs={d['sha256']:d for d in text_report['documents']}
    groups={};members=[];blockers=[]
    for row in q:
        key=(row['image'],row['artifactId']);prior=(row['image'],row['priorArtifactId']);ctx=contexts[key];need((ctx['name'],ctx['version'],ctx['imageId'])==(row['name'],row['version'],row['imageId']),'Changed identity')
        actual=[{k:maps[row['image']][p].get(k) for k in ['path','sha256','type','link']} for p in ctx['files']];need(sha(enc(actual))==ctx['payloadSignature'],'Changed owned payload')
        typ=row['type'];root=ctx['primaryPaths'][0].rsplit('/',1)[0]+'/' if typ=='npm' and ctx['primaryPaths'] else None
        relative=[{'path':p[len(root):] if root and p.startswith(root) else p,'sha256':maps[row['image']][p].get('sha256'),'type':maps[row['image']][p]['type'],'link':maps[row['image']][p].get('link')} for p in ctx['files']]
        need(sha(enc(relative))==ctx['relativePayloadSignature'],'Changed relative payload signature')
        need(ctx['retainedFileCount']==len(ctx['files']) and ctx['nativePaths']==[p for p in ctx['files'] if (row['image'],p) in native],'Changed payload coverage')
        kind={'rust-crate':'embedded-compiled-component','go-module':'embedded-compiled-component','java-archive':'jvm-jar','npm':'javascript-package','python':'python-source-or-extension','binary':'standalone-runtime'}.get(typ,'os-package-bundle')
        situation={'kind':kind,'distribution':'conveyed OCI image/offline software bundle, not SaaS-only','modificationEvidence':'bytes retained from original assembly; upstream patch state and corresponding source not inferred','hasNativePayload':bool(ctx['nativePaths']),'nativeForms':sorted({native[(row['image'],p)]['format'] for p in ctx['nativePaths']}),'scopeCaveat':'same container does not establish a combined work; DT_NEEDED does not exclude dlopen/static incorporation'}
        situation['incomingNativeContextSha256']=sha(enc(sorted({enc(e).decode() for p in ctx['nativePaths'] for e in incoming[(row['image'],p)]})))
        situation['outgoingNativeContextSha256']=sha(enc(sorted({enc(e).decode() for p in ctx['nativePaths'] for e in outgoing[(row['image'],p)]})))
        docs=old[prior]['observedNoticeDocuments'];ev=[{'sha256':d['sha256'],'path':d['path']} for d in docs];dec=row.get('engineeringDisposition');ov=overlay.get(key);m=meta[prior]
        if ov:expressions=[ov['licenceExpression']];ev=[{'sha256':d['sha256'],'path':d['archivePath']} for d in ov['evidence']]
        elif dec:expressions=[dec.get('selectedAlternative','MIT')]
        else:
            expressions=[v for v in row['declaredLicenses'] if not v.startswith('sha256:')];expressions+=m.get('upstreamEvidenceLicenses',[]);expressions+=observed_ids(m)
            if m.get('workspaceEvidence'):expressions.append(m['workspaceEvidence']['declaration'])
            for registry_key in ['registryEvidence','registryLookup']:
                for declaration in m.get(registry_key,{}).get('declarations',[]):
                    if isinstance(declaration,str):expressions.append(declaration)
                    elif declaration.get('name'):expressions.append(declaration['name'])
                    elif declaration.get('url'):expressions.append(declaration['url'])
        expressions=sorted(set(expressions));profile=licence_profile(expressions);req,issues=requirements(profile,situation)
        if ov and ov['classification'] in ['zero-payload-package-manager-descriptor','first-party-restricted']:
            profile={'expressions':expressions,'terms':expressions,'families':['descriptor' if ov['classification'].startswith('zero') else 'first-party'],'selectedAlternatives':[],'unresolvedTerms':[]};issues=[]
            if ov['classification'].startswith('zero'):req={k:{'applicability':'not-required','basis':'Step-2 proof: generated zero-payload dependency descriptor; dependencies remain separately assessed.','fulfilled':False} for k in ['noticeDelivery','correspondingSource','buildInstructions','relinkOrReplacement','licenceCompatibility']}
            else:req={k:{'applicability':'not-required','basis':'First-party proprietary declaration does not require public source/build/relink delivery; not a waiver of third-party or combined-work obligations.','fulfilled':False} for k in ['correspondingSource','buildInstructions','relinkOrReplacement']};req['licensorAndThirdPartyCarveouts']={'applicability':'required','basis':ov['facts']['legalHold']+' Preserve third-party rights; no new grant or authority approval.','fulfilled':False}
        if row['type']=='npm' and row['name']=='gsap':
            report=load('clean-candidate-review/step3-gsap/report.json');need(row['version']=='3.15.0' and not report['errors'],'GSAP coordinate/evidence changed')
            objects={k:read('clean-candidate-review/step3-gsap/objects/'+report[k]['sha256']) for k in ['registry','archive','referencedPage','incorporatedTerms']}
            for k,v in objects.items():need(sha(v)==report[k]['sha256'],'GSAP object drift')
            need(hashlib.sha1(objects['archive']).hexdigest()==json.loads(objects['registry'])['dist']['shasum'],'GSAP registry archive drift')
            with tarfile.open(fileobj=io.BytesIO(objects['archive']),mode='r:gz') as archive:
                for path in ctx['files']:
                    member=archive.getmember('package/'+path[len(root):]);f=archive.extractfile(member)
                    if f is None:raise ValueError('GSAP file missing')
                    need(sha(f.read())==maps[row['image']][path]['sha256'],'GSAP shipped bytes differ from exact upstream')
            profile={'expressions':['LicenseRef-GSAP-NoCharge-2025-05-30'],'terms':['LicenseRef-GSAP-NoCharge-2025-05-30'],'families':['restricted-no-charge'],'selectedAlternatives':[],'unresolvedTerms':[]}
            req={k:{'applicability':'not-required','basis':'The captured GSAP-specific terms impose no corresponding-source/build/relink delivery requirement. This is not a determination that standalone redistribution is authorized.','fulfilled':False} for k in ['correspondingSource','buildInstructions','relinkOrReplacement']}
            req['noticeDelivery']={'applicability':'required','basis':'Preserve proprietary notices and branding; include GSAP terms and their precedence over incorporated Webflow terms.','fulfilled':False}
            req['useRestrictions']={'applicability':'required','basis':'No prohibited competing visual animation builder use without consent. Publisher FAQ expressly permits AI-generated GSAP code and commercial projects; no-charge is not unrestricted open-source licensing.','fulfilled':False}
            req['standaloneRedistributionPermission']={'applicability':'blocked','basis':'GSAP grants use/reproduction/display/implementation for permitted uses. Incorporated Webflow terms restrict distribution/sublicensing except as permitted by the specific agreement. Obtain a scoped legal determination or publisher clarification for bundling the standalone SDK in the DSH OCI/offline delivery; do not infer unrestricted resale rights.','fulfilled':False}
            issues=[{'code':'gsap-standalone-bundle-grant-review','action':req['standaloneRedistributionPermission']['basis'],'evidence':{k:report[k] for k in ['registry','archive','referencedPage','incorporatedTerms']},'allRetainedPackageFilesMatchExactArchive':True}]
            ev.extend({'sha256':report[k]['sha256'],'path':'step3-gsap/objects/'+report[k]['sha256']} for k in ['referencedPage','incorporatedTerms'])
        mentioned=set(profile['terms'])
        for tree in profile.get('syntaxTrees',[]):mentioned.update(flatten(tree))
        if dec or profile.get('selectedAlternatives'):
            originals=row['declaredLicenses']+m.get('upstreamEvidenceLicenses',[])
            if m.get('workspaceEvidence'):originals.append(m['workspaceEvidence']['declaration'])
            for expression in originals:
                try:tree=parse_expression(normalize(expression))
                except ValueError:continue
                if tree[0]=='or' and all(n[0]=='licence' for n in tree[1:]) and set(flatten(tree)) & set(profile['terms']):mentioned.update(flatten(tree))
        detected=sorted({term for d in ev for match in text_docs.get(d['sha256'],{}).get('matches',[]) if match['isLicenceText'] and match['coverage']==100 and match['score']>=99 for term in match['spdxKeys'].values()})
        extras=sorted(set(detected)-mentioned)
        if extras and not issues and set(extras)<={'MIT','ISC','BSD-2-Clause','BSD-3-Clause','BSD-4-Clause','Apache-2.0','0BSD','X11'}:
            profile['additionalNoticeTerms']=extras
            profile['noticeCoveragePolicy']='Retain and fulfil all these known permissive notice terms conservatively; not an inferred SPDX AND or a per-file licence reassignment.'
            profile['terms']=sorted(set(profile['terms'])|set(extras));profile['families']=sorted(set(profile['families'])|{'permissive'})
            req,issues=requirements(profile,situation);extras=[]
        if extras and not (ov and ov['classification']=='first-party-restricted'):
            issues.append({'code':'additional-notice-terms-scope-review','terms':extras,'action':'Full licence text was recognized in scoped notice evidence. Determine covered files/alternatives/exceptions before issuing a source/relink waiver; recognition alone is not a licence-scope decision.'})
            for field in ['correspondingSource','buildInstructions','relinkOrReplacement']:
                if req.get(field,{}).get('applicability')=='not-required':req[field]={'applicability':'blocked','basis':'Additional notice terms need component/file scope review before this waiver.','fulfilled':False}
        if not ctx['retainedFileCount'] and not (ov and ov['classification']=='zero-payload-package-manager-descriptor'):issues.append({'code':'payload-ownership-incomplete','action':'Resolve empty package-manager/editable-project ownership; do not treat this as absent code.'})
        shape={'name':row['name'],'version':row['version'],'type':typ,'purl':row['purl'],'payload':ctx['relativePayloadSignature'],'noticeHashes':sorted({d['sha256'] for d in ev}),'licenceProfile':profile,'situation':situation,'requirements':req,'blockers':issues}
        gid=sha(enc(shape));family=sha(enc({'name':row['name'],'version':row['version'],'type':typ,'purl':row['purl']}));g=groups.setdefault(gid,{'groupId':gid,'componentFamilyId':family,**shape,'occurrences':[]});g['occurrences'].append({'image':row['image'],'artifactId':row['artifactId']});members.append({'image':row['image'],'artifactId':row['artifactId'],'groupId':gid,'primaryPaths':ctx['primaryPaths'],'payloadSignature':ctx['payloadSignature'],'nativePaths':ctx['nativePaths']})
    ordered=sorted(groups.values(),key=lambda r:(r['type'],r['name'],r['version'],r['groupId']))
    for g in ordered:
        if g['blockers']:blockers.append({'groupId':g['groupId'],'name':g['name'],'version':g['version'],'occurrences':g['occurrences'],'issues':g['blockers'],'noticeHashes':g['noticeHashes']})
    decided=sum(len(g['occurrences']) for g in ordered if not g['blockers']);summary={'schema':'stage74-step3-obligations/v1','candidateLockSha256':sha(enc(lock)),'occurrences':len(q),'componentFamilies':len({g['componentFamilyId'] for g in ordered}),'contextualGroups':len(ordered),'groupsWithRepeatedOccurrences':sum(len(g['occurrences'])>1 for g in ordered),'decidedGroups':len(ordered)-len(blockers),'blockedGroups':len(blockers),'decidedOccurrences':decided,'blockedOccurrences':len(q)-decided,'step3Complete':not blockers,'fulfilmentAssessed':False,'engineeringComplete':False,'legalApproval':False,'fullStackRequalified':False,'nativePayloadsInspected':len(native),'dynamicDependencyEdges':len(edges),'originalQAUnchanged':c['originalQAUnchanged']}
    summary.update({'groupingComplete':True,'textDocumentsInspected':len(text_docs),'openReviewsAreNotFindingsOfInfringement':True,'reviewStatus':'complete' if not blockers else 'partial-applicability-review'})
    for name in ['build_step3_obligations.py','collect_step3_context.py','scan_step3_licence_texts.py','collect_step3_gsap.py','test_step3_obligations.py']:read(name)
    outputs={n:enc(v) for n,v in {'summary.json':summary,'groups.json':ordered,'occurrence-to-group.json':members,'blockers.json':blockers,'native-linking-evidence.json':{'scope':'Static ELF observations only; no absence inference or full loader resolution','edges':edges,'providerOwners':[{'image':k[0],'path':k[1],'artifactIds':v} for k,v in sorted(owners.items())]}}.items()}
    sheet=io.StringIO();writer=csv.writer(sheet,lineterminator='\n',quoting=csv.QUOTE_ALL)
    writer.writerow(['groupId','type','name','version','occurrences','images','terms','source','build','relink','notice','reviewStatus','openIssueCodes'])
    for g in ordered:
        cells=[g['groupId'],g['type'],g['name'],g['version'],str(len(g['occurrences'])),','.join(sorted({x['image'] for x in g['occurrences']})),' | '.join(g['licenceProfile']['terms'])]
        cells += [g['requirements'].get(k,{}).get('applicability','see group detail') for k in ['correspondingSource','buildInstructions','relinkOrReplacement','noticeDelivery']]
        cells += ['open-review' if g['blockers'] else 'bounded-decision',','.join(x['code'] for x in g['blockers'])]
        writer.writerow(["'"+x if x.startswith(('=','+','-','@','\t','\r')) else x for x in cells])
    outputs['group-obligations.csv']=sheet.getvalue().encode()
    lines=['# Step 3 — '+('complete' if summary['step3Complete'] else 'OPEN: partial applicability review'),'','| Measure | Count |','|---|---:|']
    for key in ['occurrences','componentFamilies','contextualGroups','groupsWithRepeatedOccurrences','decidedGroups','blockedGroups','decidedOccurrences','blockedOccurrences','nativePayloadsInspected','dynamicDependencyEdges','textDocumentsInspected']:lines.append(f'| {key} | {summary[key]} |')
    lines+=['','All occurrences are assigned exactly once. Open reviews are not findings of infringement.','Requirements are not fulfilment. No engineering/legal/full-stack clearance is issued.','','See `group-obligations.csv`, `groups.json` and `blockers.json` for individual outcomes.']
    outputs['STATUS.md']=('\n'.join(lines)+'\n').encode()
    outputs['inputs.json']=enc({'inputs':inputs,'outputs':{n:sha(v) for n,v in outputs.items()}});return outputs

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');p.add_argument('--require-complete',action='store_true');args=p.parse_args();files=derive();OUT.mkdir(exist_ok=True)
    for name,data in files.items():
        if args.verify:need((OUT/name).read_bytes()==data,'Changed Step-3 artifact: '+name)
        else:(OUT/name).write_bytes(data)
    status=json.loads(files['summary.json']);print(json.dumps(status))
    if args.require_complete and not status['step3Complete']:raise SystemExit(2)
if __name__=='__main__':main()
