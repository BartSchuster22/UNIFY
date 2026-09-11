"""Reconstruct the qualified fixture with preserved limits and late-bound private DNS."""
import http.client,json,os,socket
from pathlib import Path
import restore_dsh2 as r
FIELDS=('Binds','Mounts','NetworkMode','RestartPolicy','PortBindings','ReadonlyRootfs','CapDrop','CapAdd','SecurityOpt','Tmpfs','Memory','PidsLimit','Init','LogConfig','CpuShares','CpuPeriod','CpuQuota','NanoCpus','CpusetCpus','CpusetMems','MemorySwap','MemoryReservation','OomKillDisable','OomScoreAdj','Ulimits','Sysctls','Dns','DnsSearch','DnsOptions','ShmSize','Runtime','MaskedPaths','ReadonlyPaths','IpcMode','PidMode','UsernsMode','UTSMode','CgroupnsMode','Devices','DeviceRequests','DeviceCgroupRules','Privileged')
def body(m):
 assert os.geteuid()==0 and socket.gethostname()=='DSH2'
 old={c['Name']:c for c in m['metadata']['containers']};ref=old['/dsh5-reference-qa5'];network=r.CELL+'_application';caddy=json.loads(r.run(['docker','inspect',r.CELL+'-caddy-1']))[0]
 assert caddy['Image']==old['/'+r.CELL+'-caddy-1']['Image'] and caddy['Config']['Labels']==old['/'+r.CELL+'-caddy-1']['Config']['Labels']
 old_ip=old['/'+r.CELL+'-caddy-1']['NetworkSettings']['Networks'][network]['IPAddress'];new_ip=caddy['NetworkSettings']['Networks'][network]['IPAddress']
 import ipaddress
 extras=ref['HostConfig']['ExtraHosts'];assert isinstance(extras,list) and len(extras)==1
 host,old_address=extras[0].split(':',1);assert host=='stage5.qa.invalid'
 assert ipaddress.ip_address(old_address) in ipaddress.ip_network('10.84.0.0/24') and ipaddress.ip_address(new_ip) in ipaddress.ip_network('10.84.0.0/24')
 # Cold Docker inspection clears ephemeral IPAddress; the retained alias is authoritative.
 assert host in old['/'+r.CELL+'-caddy-1']['NetworkSettings']['Networks'][network]['Aliases']
 if old_ip:assert old_address==old_ip
 assert not ref['HostConfig']['Privileged'] and not ref['HostConfig']['PidMode'] and ref['HostConfig']['NetworkMode']==network
 b={k:ref['Config'][k] for k in ('Cmd','Entrypoint','User','WorkingDir','Env','Labels','ExposedPorts','Healthcheck','StopSignal','StopTimeout') if k in ref['Config']};b['Image']=ref['Image']
 b['HostConfig']={k:ref['HostConfig'][k] for k in FIELDS if k in ref['HostConfig']};b['HostConfig']['ExtraHosts']=['stage5.qa.invalid:'+new_ip]
 # Docker materializes an omitted OOM-disable flag as false; never normalize true.
 if b['HostConfig'].get('OomKillDisable') is None:b['HostConfig']['OomKillDisable']=False
 b['NetworkingConfig']={'EndpointsConfig':{network:{'IPAMConfig':{'IPv4Address':'10.84.0.10'},'Aliases':['notebook.dsh.invalid']}}};return b
class Docker(http.client.HTTPConnection):
 def connect(self):self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.connect('/var/run/docker.sock')
def create(b):
 c=Docker('localhost',timeout=60);c.request('POST','/v1.44/containers/create?name=dsh5-reference-qa5',json.dumps(b),{'Content-Type':'application/json'});response=c.getresponse();answer=json.loads(response.read());assert response.status==201,'Reference creation refused';c.close()
 row=json.loads(r.run(['docker','inspect',answer['Id']]))[0]
 for key,value in b['HostConfig'].items():assert row['HostConfig'][key]==value,'Reference host configuration mismatch: '+key
 return answer['Id']
def repair():
 import update_ops as u
 u.guard();u.native_quiescent();assert r.archive.digest(r.OUT/'restored-manifest.json')==r.MANIFEST
 m=json.loads((r.OUT/'restored-manifest.json').read_text());b=body(m);before=u.logical_state.snapshot()
 current=json.loads(r.run(['docker','inspect','dsh5-reference-qa5']))[0];assert current['Image']==b['Image'] and current['Config']['Labels']==b['Labels']
 with u.lock(u.ROOT/'operations/operation.lock'),u.lock(u.ROOT.parent/('.'+u.CELL+'.install.lock')):
  r.run(['docker','stop','--time','30','dsh5-reference-qa5']);data=Path('/var/lib/alica-stage5-qa5/reference-data');cold=u.tree(data)
  r.run(['docker','rm','dsh5-reference-qa5']);id=create(b);assert u.tree(data)==cold;r.run(['docker','start',id])
 assert u.logical_state.snapshot()==before
 report={'schema':'stage6-reference-topology-repair/v1','hostMapping':b['HostConfig']['ExtraHosts'],'hostConfigurationFieldsVerified':len(b['HostConfig']),'coldDataUnchangedBeforeStart':True,'logicalDataPreserved':True,'imageId':b['Image']};r.save(r.OUT/'reference-topology-repair.json',report);return report
if __name__=='__main__':print(json.dumps(repair()))
