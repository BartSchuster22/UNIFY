#!/usr/bin/env python3
"""DSH2 bounded cold restore. Never overwrites an installation or starts on import.
Apply requires empty Docker state, a changed boot ID and authenticated staged data.
QA3/QA4 remain archival. Only QA5 may be activated explicitly after cold checks.
"""
import argparse,hashlib,json,os,pwd,shutil,socket,stat,subprocess,sys,time
from pathlib import Path
sys.dont_write_bytecode=True
import archive
CELL='dsh2-stage5-qa5'
CELLS=['dsh2-stage5-qa'+n for n in ('3','4','5')]
CIPHER='151c953b147ab74d21e72886095f00af80bddabeda5817862adadd9210558818'
MANIFEST='bbe41744ac13f32444f1783508ffbcb2ae21b7825939f0956578c911c7b18832'
RELEASE='1fde4fdfeea219bbad1e61e6bcce8046b2a7f9d880218d95a660624be08cd4f6'
REFERENCE='51c522b717e99eb6bb1025c442e713e9f6a1827fbeecef7a70f2cdc12618fd7b'
OUT=Path('/var/lib/alica-stage6-recovery')
class Refused(ValueError):pass
def need(ok,message):
 if not ok:raise Refused(message)
def run(args,timeout=900):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise Refused('Command failed: '+args[0]+'; exit '+str(p.returncode))
 return p.stdout.strip()
def save(path,data):
 temp=path.with_suffix('.new');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:json.dump(data,f,indent=2);f.flush();os.fsync(f.fileno())
 os.replace(temp,path);fd=os.open(path.parent,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def manifest(stage):
 need(archive.digest(stage/'manifest.json')==MANIFEST,'Manifest fingerprint mismatch')
 need((stage/'VERIFIED').read_text().strip()==CIPHER,'Missing authenticated extraction marker')
 m=json.loads((stage/'manifest.json').read_text());archive.validate_manifest(m);return m

def destinations(m):
 md=m['metadata'];need(md['sourceHost']=='DSH2' and md['activeCell']==CELL and md['releaseSha256']==RELEASE,'Wrong source installation')
 need(md['roots']==CELLS and md['automaticJobsEnabled']==0,'Unqualified root/schedule state')
 need(len(md['nativeBefore']['tasks'])==3 and all(t['status'] in ('done','failed','cancelled') for t in md['nativeBefore']['tasks']),'Active native work requires another policy')
 d={}
 for c in CELLS:
  d['root-'+c]='/opt/'+c;d['qa-'+c]='/var/lib/alica-stage5-'+c.rsplit('-',1)[-1]
  d['stage5-package-'+c.rsplit('-',1)[-1]]='/srv/alica-dsh-qa/stage5-package-'+c.rsplit('-',1)[-1]
 d.update({'operations-code':'/usr/local/lib/alica-dsh-ops','qa-code':'/srv/alica-dsh-qa/qa','recovery-code':str(OUT/'archived-recovery-code'),'units':str(OUT/'archived-units')})
 need(len(md['volumes'])==15,'Unexpected volume inventory')
 for v in md['volumes']:
  labels=v['Labels'];cell=labels.get('com.alica.stage2');name=v['Name']
  need(cell in CELLS and labels.get('com.docker.compose.project')==cell,'Foreign volume')
  need(name in [cell+'_'+n for n in ('alica-data','caddy-config','caddy-data','memory-data','postgresql-data')],'Unqualified volume')
  need(v['Driver']=='local' and not v.get('Options'),'Nonportable volume driver')
  mount='/var/lib/docker/volumes/'+name+'/_data';need(v['Mountpoint']==mount,'Unexpected source mountpoint');d['volume-'+name]=mount
 need(set(d)=={r['name'].split('/')[0] for r in m['entries']},'Unmapped/missing archive prefix')
 for c in md['containers']:
  labels=c['Config'].get('Labels') or {};need(labels.get('com.alica.stage2') in CELLS or c['Name']=='/dsh5-reference-qa5','Foreign container')
  for mount in c['Mounts']:
   if mount['Type']=='bind':need(any(mount['Source']==p or mount['Source'].startswith(p+'/') for p in d.values()),'Uncaptured bind dependency')
   else:need(mount['Type']=='volume' and mount['Source'] in d.values(),'Uncaptured mount dependency')
 return d

def verify_tree(m,locate):
 for row in m['entries']:
  p=locate(row['name']);actual=archive.entry(p,row['name'])
  for k in ('type','size','mode','uid','gid','sha256','target'):
   need(actual.get(k)==row.get(k),'Restored metadata/content differs: '+row['name']+' '+k)
 return len(m['entries'])
def mapped(name,d):
 prefix,_,rest=name.partition('/');return Path(d[prefix])/rest

def apply(stage,previous_boot):
 need(os.geteuid()==0 and socket.gethostname()=='DSH2','Only root on DSH2 may apply')
 need(previous_boot and Path('/proc/sys/kernel/random/boot_id').read_text().strip()!=previous_boot,'Original boot: refuse restore')
 m=manifest(stage);d=destinations(m);verify_tree(m,lambda n:stage/n)
 need(not run(['docker','ps','-aq']) and not run(['docker','volume','ls','-q']),'Nonempty Docker target')
 need(run(['docker','info','--format','{{.DockerRootDir}}'])=='/var/lib/docker','Unqualified Docker root')
 need(run(['docker','info','--format','{{.Driver}}'])=='overlay2','Pinned recovery requires legacy overlay2 image store')
 need(shutil.disk_usage('/var/lib').free>8*1024**3,'Insufficient reserve disk')
 for dest in d.values():need(not Path(dest).exists() and not Path(dest).is_symlink(),'Restore target exists: '+dest)
 OUT.mkdir(mode=0o700,exist_ok=True);journal=OUT/'restore-journal.json';need(not journal.exists(),'Existing restore transaction: no automatic overwrite')
 receipt={'phase':'restoring-fenced','ciphertextSha256':CIPHER,'manifestSha256':MANIFEST,'previousBootId':previous_boot,'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'promoted':[],'wholeStage6Accepted':False};save(journal,receipt)
 for v in m['metadata']['volumes']:
  args=['docker','volume','create','--driver','local']
  for k,val in sorted(v['Labels'].items()):args+=['--label',k+'='+val]
  args+=[v['Name']];run(args)
  got=json.loads(run(['docker','volume','inspect',v['Name']]))[0]
  need(got['Mountpoint']==d['volume-'+v['Name']] and got['Labels']==v['Labels'],'Created volume differs')
 for prefix,dest in d.items():
  target=Path(dest);target.parent.mkdir(parents=True,exist_ok=True)
  if target.exists():need(prefix.startswith('volume-') and not any(target.iterdir()),'Occupied destination')
  os.replace(stage/prefix,target);receipt['promoted'].append(prefix);save(journal,receipt)
 receipt['entriesVerifiedAfterPromotion']=verify_tree(m,lambda n:mapped(n,d))
 shutil.copyfile(stage/'manifest.json',OUT/'restored-manifest.json');os.chmod(OUT/'restored-manifest.json',0o600)
 receipt['phase']='cold-restored';receipt['containersStarted']=0;save(journal,receipt);return receipt

def activate(reference_image):
 need(os.geteuid()==0 and socket.gethostname()=='DSH2','Only root on DSH2 may activate')
 journal=OUT/'restore-journal.json';receipt=json.loads(journal.read_text());need(receipt['phase']=='cold-restored','Cold verification required')
 m=json.loads((OUT/'restored-manifest.json').read_text());need(archive.digest(OUT/'restored-manifest.json')==MANIFEST,'Manifest changed');d=destinations(m)
 verify_tree(m,lambda n:mapped(n,d));need(not run(['docker','ps','-aq']),'Unexpected containers')
 need(archive.digest(reference_image)==REFERENCE,'Reference image checksum mismatch')
 bundle=Path('/srv/alica-dsh-qa/stage5-package-qa5');root=Path('/opt')/CELL
 run(['docker','load','-i',str(bundle/'images.tar')]);run(['docker','load','-i',str(reference_image)])
 sys.path.insert(0,str(bundle));from install import Installer
 request=json.loads((root/'operations/request.json').read_text());i=Installer(bundle,RELEASE,root,request);i.operator()
 for image in i.release['images'].values():need(run(['docker','image','inspect',image['id'],'--format','{{.Id}}'])==image['id'],'Loaded image identity mismatch')
 try:user=pwd.getpwnam('alica-ops')
 except KeyError:
  run(['useradd','--system','--no-create-home','--shell','/usr/sbin/nologin','alica-ops']);user=pwd.getpwnam('alica-ops')
 cfg_path=root/'operations/broker.json';cfg=json.loads(cfg_path.read_text());receipt['observerIdentityMapping']={'oldUid':cfg['observerUid'],'oldGid':cfg['observerGid'],'newUid':user.pw_uid,'newGid':user.pw_gid}
 cfg['observerUid']=user.pw_uid;cfg['observerGid']=user.pw_gid;save(cfg_path,cfg)
 receipt['phase']='activating-qa5';save(journal,receipt)
 # Installer start preserves existing identities/databases; never runs install/migrate/reconcile.
 run(['python3',str(bundle/'ops.py'),'start','--bundle',str(bundle),'--release-sha256',RELEASE,'--root',str(root),'--request',str(root/'operations/request.json')])
 for unit in (OUT/'archived-units').glob('alica-'+CELL+'-*.service'):
  target=Path('/etc/systemd/system')/unit.name;need(not target.exists(),'Unit collision');shutil.copy2(unit,target)
 run(['systemctl','daemon-reload']);units=['alica-'+CELL+'-'+n+'.service' for n in ('cell','broker','observer')]
 run(['systemctl','enable',*units]);run(['systemctl','start',*units])
 # Preserve qualified resource/security fields and late-bind the private backend address.
 from reference_restore import body,create
 run(['docker','start',create(body(m))])
 receipt['phase']='activated-awaiting-acceptance';receipt['retiredCellsActivated']=False;save(journal,receipt);return receipt

def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='action',required=True)
 for verb in ('plan','apply'):
  a=sub.add_parser(verb);a.add_argument('--stage',type=Path,required=True)
  if verb=='apply':a.add_argument('--previous-boot-id',required=True)
 a=sub.add_parser('activate');a.add_argument('--reference-image',type=Path,required=True);args=p.parse_args()
 if args.action=='plan':
  m=manifest(args.stage);d=destinations(m);out={'destinations':d,'entriesVerified':verify_tree(m,lambda n:args.stage/n),'mutations':False,'wholeStage6Accepted':False}
 elif args.action=='apply':out=apply(args.stage,args.previous_boot_id)
 else:out=activate(args.reference_image)
 print(json.dumps(out))
if __name__=='__main__':main()
