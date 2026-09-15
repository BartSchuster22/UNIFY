"""Package already-built/tested JavaScript outputs against unchanged pinned dev3 runtimes.
Run contracts/adapter/gateway/UI builds and regression tests first. No dependencies,
credentials, native Hermes Python, runtime settings, or user data enter the archive.
Usage: python package_step6_overlay.py /absolute/output-directory
"""
import hashlib,json,shutil,sys,tarfile
from pathlib import Path
root=Path(__file__).resolve().parents[3]
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=False)
bases={'core':'fb21d745432133038d4b92b44a8569af84f4b04f42ad9661a6591e0bd42b0e5b','hermes':'8696a1321b16ca00562d95cbf77582b42d07ca4ff63f4493131e2783a2baf7ca','ui':'74433dcba1253dac1ba319b0e3a6e0fd23e94a44576d075e4208d22af9f46753'}
if len(sys.argv)>2:bases=json.loads(Path(sys.argv[2]).read_text())
assert set(bases)=={'core','hermes','ui'} and all(len(v)==64 and all(c in '0123456789abcdef' for c in v) for v in bases.values())
pairs=[('apps/gateway/dist','core/app/dist'),('apps/hermes-control-adapter/dist','hermes/opt/unify-adapter/dist'),('apps/uniui/dist','ui/app/public')]
for service,base in [('core','app'),('hermes','opt/unify-adapter')]:pairs.append(('packages/contracts/dist',service+'/'+base+'/node_modules/.pnpm/@aquiero+contracts@file+packages+contracts/node_modules/@aquiero/contracts/dist'))
manifest={}
for source,target in pairs:
 src=root/source;assert src.is_dir(),source
 for p in src.rglob('*'):assert not p.is_symlink(),p
 shutil.copytree(src,out/target)
 for p in (out/target).rglob('*'):
  if p.is_file():manifest[str(p.relative_to(out))]=hashlib.sha256(p.read_bytes()).hexdigest()
(out/'manifest.json').write_text(json.dumps({'baseImages':bases,'lockfileSha256':hashlib.sha256((root/'pnpm-lock.yaml').read_bytes()).hexdigest(),'files':manifest},indent=2)+'\n')
(out/'Dockerfile').write_text('\n'.join('FROM sha256:'+digest+' AS '+service+'\nCOPY '+('--chown=65532:65532 ' if service!='hermes' else '')+service+'/ /' for service,digest in bases.items())+'\n')
with tarfile.open(str(out)+'.tar.gz','w:gz') as t:
 for p in sorted(out.iterdir()):t.add(p,arcname=p.name)
print(json.dumps({'archive':str(out)+'.tar.gz','files':len(manifest),'baseImages':bases}))
