#!/usr/bin/env python3
"""Build-time operator configuration; emits a NEW release trust anchor before install.
Never run against a bundle already used by an installation. Not a runtime bypass.
"""
import argparse,hashlib,ipaddress,json,pathlib
from urllib.parse import urlsplit

def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 return h.hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--bundle',type=pathlib.Path,required=True);p.add_argument('--expected-sha',required=True);p.add_argument('--pins',type=pathlib.Path,required=True);p.add_argument('--application-subnet');a=p.parse_args();b=a.bundle
 assert sha(b/'release.json')==a.expected_sha
 r=json.loads((b/'release.json').read_text());assert 'DEVELOPMENT CANDIDATE' in r['acceptance']
 for n,h in r['files'].items():assert pathlib.Path(n).name==n and sha(b/n)==h
 pins=json.loads(a.pins.read_text());assert isinstance(pins,dict) and len(pins)<=16
 private=[ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')]
 for url,ips in pins.items():
  u=urlsplit(url);assert u.scheme=='https' and u.hostname and not(u.username or u.password or u.fragment) and u.port in (None,443)
  assert isinstance(ips,list) and 0<len(ips)<=32
  for ip in ips:
   v=ipaddress.IPv4Address(ip);assert v.is_global or any(v in n for n in private)
 d=json.loads((b/'compose.template.json').read_text());d['services']['unify-core']['environment']['APPLICATION_CALLBACK_PINS_JSON']=json.dumps(pins,separators=(',',':'))
 # Callback egress is separate from native model egress. Destination enforcement
 # remains in Core (all DNS answers checked, TLS verified, redirects refused).
 d['networks']['callback-egress']={'internal':False,'labels':{'com.alica.stage2':'dsh2-template'}}
 if 'callback-egress' not in d['services']['unify-core']['networks']:d['services']['unify-core']['networks'].append('callback-egress')
 if a.application_subnet:
  n=ipaddress.IPv4Network(a.application_subnet);assert n.prefixlen>=24 and any(n.subnet_of(x) for x in private)
  d['networks']['application']['ipam']={'config':[{'subnet':str(n)}]}
 (b/'compose.template.json').write_text(json.dumps(d,indent=2)+'\n')
 r['files']['compose.template.json']=sha(b/'compose.template.json');r['operator_callback_configuration']=True
 (b/'release.json').write_text(json.dumps(r,indent=2)+'\n');h=sha(b/'release.json');(b/'release.sha256').write_text(h+'  release.json\n');print(json.dumps({'release_sha256':h,'requiresNewInstall':True}))
if __name__=='__main__':main()
