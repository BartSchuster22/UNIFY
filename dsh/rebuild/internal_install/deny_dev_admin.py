from pathlib import Path
import subprocess,os
r=Path('/opt/alica-dev-edge');p=r/'Caddyfile';old=p.read_text();needle=' reverse_proxy dsh2-internal-dev3-edge:8080'
assert old.count(needle)==1
new=old.replace(needle,' @private_identity path /identity/admin /identity/admin/* /identity/realms/master /identity/realms/master/*\n respond @private_identity 404\n'+needle)
staged=r/'Caddyfile.admin-guard';staged.write_text(new);staged.chmod(0o644)
subprocess.run(['docker','run','--rm','--network','none','--entrypoint','caddy','-e','UNIFY_PUBLIC_HOST=unify.167-233-135-142.sslip.io','--tmpfs','/var/log/caddy:mode=0777','-v',str(staged)+':/etc/caddy/Caddyfile:ro','sha256:1b3a76433f6c1517aff303665985ff07addc39f16cf47aaa4efd633d579566cf','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],check=True)
(r/'Caddyfile.before-admin-guard').write_text(old)
with p.open('r+') as f:f.write(new);f.truncate();f.flush();os.fsync(f.fileno())
subprocess.run(['docker','restart','--timeout','20','unify-caddy-1'],check=True)
